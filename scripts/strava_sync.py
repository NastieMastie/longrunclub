"""Pull new runs from a Strava club into data/runs.json.

Runs hourly in GitHub Actions (see .github/workflows/sync.yml). Uses only the Python standard library.

Why a club? Strava's API terms (Nov 2024) only let an app show a person's data to that person,
and new Strava API apps are limited to a single athlete (you). The club activity feed is data
club members already share with each other, and it only needs *your* login.

Trade-off: the club feed doesn't include dates, so a run is stamped with the time this script
first sees it. Running hourly keeps that within an hour of the upload.

Env vars: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN, STRAVA_CLUB_ID
Optional: TZ_OFFSET_HOURS (e.g. -5 for US Central in winter), BACKFILL=1 to import the
club's current feed on the very first sync (stamped as today) instead of just marking it seen.
"""
import datetime as dt
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DATA = os.path.join(os.path.dirname(__file__), "..", "data", "runs.json")
SEEN = os.path.join(os.path.dirname(__file__), "..", "data", "strava_seen.json")
RUN_TYPES = {"Run", "TrailRun", "VirtualRun"}
METERS_PER_MILE = 1609.344


def post(url, fields):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def get(url, token):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def activity_key(a):
    # The club feed has no activity ids, so fingerprint the fields that identify a run.
    ath = a.get("athlete", {})
    raw = "|".join(str(x) for x in (ath.get("firstname"), ath.get("lastname"), a.get("name"),
                                    a.get("distance"), a.get("moving_time"), a.get("elapsed_time")))
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def main():
    env = os.environ
    missing = [k for k in ("STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REFRESH_TOKEN", "STRAVA_CLUB_ID") if not env.get(k)]
    if missing:
        print("Skipping sync, missing secrets:", ", ".join(missing))
        return

    tok = post("https://www.strava.com/oauth/token", {
        "client_id": env["STRAVA_CLIENT_ID"],
        "client_secret": env["STRAVA_CLIENT_SECRET"],
        "grant_type": "refresh_token",
        "refresh_token": env["STRAVA_REFRESH_TOKEN"],
    })
    # Strava can rotate the refresh token. Hand the new one to the workflow so it can update the secret.
    if tok.get("refresh_token") and tok["refresh_token"] != env["STRAVA_REFRESH_TOKEN"]:
        out = env.get("GITHUB_OUTPUT")
        if out:
            with open(out, "a") as f:
                f.write(f"new_refresh_token={tok['refresh_token']}\n")
        print("::add-mask::" + tok["refresh_token"])
        print("Strava issued a new refresh token.")

    feed = get(f"https://www.strava.com/api/v3/clubs/{env['STRAVA_CLUB_ID']}/activities?per_page=100",
               tok["access_token"])

    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)
    first_sync = not os.path.exists(SEEN)
    seen = set() if first_sync else set(json.load(open(SEEN)))

    by_strava = {r.get("strava", "").strip().lower(): r["id"] for r in data["runners"]}
    offset = dt.timedelta(hours=float(env.get("TZ_OFFSET_HOURS", "0")))
    stamp = (dt.datetime.now(dt.timezone.utc) + offset).strftime("%Y-%m-%dT%H:%M")

    added, unknown = 0, set()
    for a in feed:
        key = activity_key(a)
        if key in seen:
            continue
        seen.add(key)
        if a.get("sport_type", a.get("type")) not in RUN_TYPES:
            continue
        ath = a.get("athlete", {})
        label = f"{ath.get('firstname', '')} {ath.get('lastname', '')}".strip()
        runner = by_strava.get(label.lower())
        if not runner:
            unknown.add(label)
            continue
        if first_sync and env.get("BACKFILL") != "1":
            continue
        data["runs"].append({
            "runner": runner,
            "date": stamp,
            "miles": round(a["distance"] / METERS_PER_MILE, 2),
            "seconds": int(a.get("moving_time") or a.get("elapsed_time") or 0),
            "source": "strava",
            "name": a.get("name", ""),
        })
        added += 1

    if not added and not first_sync:
        # Nothing new: leave the files alone so we don't make an empty commit every hour.
        print("No new runs.")
        if unknown:
            print("Club members with no matching \"strava\" name in data/runs.json:", ", ".join(sorted(unknown)))
        return
    if added:
        data["useSampleData"] = False
    data["lastSynced"] = (dt.datetime.now(dt.timezone.utc) + offset).strftime("%Y-%m-%dT%H:%M")
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    with open(SEEN, "w") as f:
        json.dump(sorted(seen), f)

    print(f"Added {added} run(s).{' First sync: existing feed marked as seen.' if first_sync and env.get('BACKFILL') != '1' else ''}")
    if unknown:
        print("Club members with no matching \"strava\" name in data/runs.json:", ", ".join(sorted(unknown)))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        print(f"Strava API error {e.code}: {e.read().decode(errors='replace')}")
        sys.exit(1)
