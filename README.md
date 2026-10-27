# Long Run Club

A mobile-first marathon-training leaderboard for a small group of friends. It's a static site with no build step: plain HTML, CSS, and JS. It's hosted free on GitHub Pages. Runners type in their runs, which are saved to a shared Google Sheet.

Live site: https://nastiemastie.github.io/running-app/

```
index.html  styles.css  app.js     ← the app
sample.js                         ← demo data generator + fallback config
data/runs.json                    ← your group: runners, race date, plan, shared log URL
scripts/shared-log.gs             ← Google Apps Script that turns a Sheet into the shared run log
scripts/strava_sync.py            ← optional, for later: pulls runs from a Strava club
.github/workflows/sync.yml        ← optional Strava sync (off by default)
```

## Try it locally
Double-click `index.html`. When the page is opened from disk, the browser blocks reading `data/runs.json`, so it falls back to the built-in sample data. That's fine for poking around. To see your real `runs.json`, serve the folder with any static server, or just push it to GitHub Pages (below).

## Customize your group
Edit `data/runs.json`:
- `runners`: id, name, bib number, and color. If you add a runner, add their `id` to `RUNNERS` in `scripts/shared-log.gs` too.
- `race.date`: your marathon date (`YYYY-MM-DD`).
- `plan`: the training-plan targets used by the readiness meter. Defaults to 8 base weeks plus an 18-week block (15 build + 3 taper), 26 weeks in all, building to 40 mi/week and a 20-mile long run. The plan start is derived from the race date minus `baseWeeks + weeks`, so changing either moves the start. Keep `sample.js`'s `DEFAULT_CONFIG.plan` in step — it is the fallback when `runs.json` can't be read.
- `sharedLog.url`: the Google Sheet web-app URL for typed-in runs (see "Shared run log" below).

Sample data shows only while there are no real runs. The first logged run replaces it.

## How the numbers work (and why)
- **Targets:** 26 weeks in three phases, starting **Oct 26, 2026** and ending at the race.
  - **Base, 8 weeks (Oct 26 – Dec 20):** 12 → 20 mi/week, long run 4 → 8 mi. The point is turning up three times a week, not mileage. Nobody is told they are "behind" during this phase.
  - **Build, 15 weeks (Dec 21 – Apr 4):** 20 → **40 mi/week**, long run 8 → **20 miles**. This is Hal Higdon's Novice 2 / Intermediate 1 shape, which suits runners averaging 15–25 mi/week — which is what the base phase is for.
  - **Taper, 3 weeks (Apr 5 – race):** back down to 20 mi/week and an 8-mile long run. The target *falls*, so the app does not tell you to run peak mileage in race week.
  - **Why the base phase:** the 18-week plan opens at 20 mi/week. Starting there cold is the exact jump the injury guardrail below warns about. The base phase ramps about 1 mi/week, roughly 8%, well under the 30% threshold.
  - **The research behind it:** marathoners averaging under ~19 mi/week (30 km) had about 2× the injury risk of those running 19–37 mi/week ([Rasmussen 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC3625790)). Training runs of more than 20 miles protected against hitting the wall ([Buman 2009](https://www.sciencedirect.com/science/article/abs/pii/S1469029209000454)).
- **Readiness %:** half weekly volume (4-week average vs. 40 mi) and half long run (longest in the last 6 weeks vs. 20 mi). The dashed line shows where the plan expects you to be today.
- **Predicted time:** the average of two models.
  - **Riegel**, `T × (26.2 / D)^1.07`, using your best three 3+ mile runs from the last 6 weeks. It uses 1.07 rather than the classic 1.06, because [Vickers & Vertosick 2016](https://bmcsportsscimedrehabil.biomedcentral.com/articles/10.1186/s13102-016-0052-y) found 1.06 predicts marathon times that are too fast.
  - **Tanda**, which predicts from your last 8 weeks of training alone: weekly distance plus average training pace ([Tanda 2011](https://running-universe.com/predicting-marathon-finish-times-the-tanda-equation/)).
- **"Easy, tiger" warning:** pops up when someone's weekly miles jump more than 30% over their previous two weeks. New runners who ramped up that fast got hurt more often ([Nielsen 2014](https://www.jospt.org/doi/pdf/10.2519/jospt.2014.5164)).
- **Streak:** consecutive weeks with at least 3 runs. A missed day doesn't break it.

---

## Shared run log (how runs get in)
After a run, tap **Log a run** and enter miles, time, and date. Runs are saved to a Google Sheet you own, so everyone sees them instantly. It's free and nobody needs an account. Past runs can be entered the same way by picking an earlier date.

One-time setup:
1. Create a new Google Sheet, e.g. "Long Run Club log".
2. **Extensions → Apps Script**. Delete what's there, paste in all of `scripts/shared-log.gs`, and click **Save**.
3. **Deploy → New deployment**. Click the gear and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**.
4. Google will warn that the app isn't verified, because it's your own script. Click **Advanced → Go to (project) → Allow**.
5. Copy the **Web app URL** (it ends in `/exec`) into `"sharedLog": { "url": "..." }` in `data/runs.json`.

Runs appear in the sheet's **Runs** tab, where you can fix typos or delete rows. Anyone with the site link can add runs, so keep the link within the group.

---

## Host it on GitHub Pages
1. Create a free account at github.com, then click **New repository**. Name it `running-app` and make it **Public**. Free Pages needs a public repo, so see the privacy note below.
2. In this folder:
   ```
   git init
   git add .
   git commit -m "Long Run Club v1"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/running-app.git
   git push -u origin main
   ```
3. In the repo, open **Settings → Pages**. Under *Source*, choose **Deploy from a branch**, then pick `main` and `/ (root)`, then **Save**.
4. After about a minute, the site is live at `https://YOUR-USERNAME.github.io/running-app/`. Text that link to your friends.
5. On iPhone, open it in Safari, tap **Share → Add to Home Screen**. It then opens full-screen like an app, with the bib icon.

**Privacy:** a public repo means anyone who finds the URL or repo can see names and mileage. Use first names only. A private repo with Pages needs GitHub Pro.

---

## Optional, later: Strava sync (covers Apple Watch + Garmin)
Not in use right now. If the group ever moves to Strava, follow these steps, then uncomment the `schedule` lines in `.github/workflows/sync.yml` to sync hourly. Also add each runner's Strava display name as `"strava": "First L."` in `data/runs.json`.

### 1. Get everyone's runs into Strava
- **Apple Watch:** In the Strava iPhone app, go to **You → Settings (gear) → Applications, Services, and Devices → Health**, and turn on **Workouts** upload. Runs recorded in the Apple Workout app now sync to Strava. You can also record directly in the Strava Watch app.
- **Garmin:** In the Garmin Connect app, go to **More → Settings → Connected Apps → Strava**, and allow it. Every Garmin run uploads to Strava automatically.

### 2. Make a Strava club
Create a club at strava.com (**Groups → Clubs → Create a Club**), make it Running, and invite your friends. Everyone has to be a member.

> **Why a club?** Strava's November 2024 API rules only let an app show a person's data *to that person*. New Strava API apps are also limited to one athlete until Strava approves more. The club feed sidesteps both: it's data members already share with each other, and it only needs **your** login. Trade-off: the feed has no dates, so each run is dated when the hourly sync first sees it.

### 3. Create a Strava API app (5 minutes)
1. Go to https://www.strava.com/settings/api and create an app. Any name works. Set **Authorization Callback Domain** to `localhost`.
2. Note the **Client ID** and **Client Secret**.
3. In a browser, open this URL, with your ID in place:
   `https://www.strava.com/oauth/authorize?client_id=YOUR_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=read`
   Click **Authorize**. The page that follows won't load, which is expected. Copy the `code=...` value from the address bar.
4. Trade the code for a refresh token. In PowerShell:
   ```
   curl.exe -X POST https://www.strava.com/oauth/token -F client_id=YOUR_ID -F client_secret=YOUR_SECRET -F code=THE_CODE -F grant_type=authorization_code
   ```
   Copy `refresh_token` from the response.
5. Find your **club ID**. It's the number in your club's URL: `strava.com/clubs/123456`.

### 4. Add the secrets to GitHub
In the repo, go to **Settings → Secrets and variables → Actions → New repository secret**, and add:

| Secret | Value |
|---|---|
| `STRAVA_CLIENT_ID` | from step 3 |
| `STRAVA_CLIENT_SECRET` | from step 3 |
| `STRAVA_REFRESH_TOKEN` | from step 4 |
| `STRAVA_CLUB_ID` | from step 5 |
| `GH_PAT` *(recommended)* | A [fine-grained token](https://github.com/settings/personal-access-tokens/new) for this repo only, with **Secrets: Read and write**. If Strava ever rotates the refresh token, the sync uses this to save the new one. |

Under the **Variables** tab, optionally add `TZ_OFFSET_HOURS` (e.g. `-5` for US Central standard time) so run dates match your local day.

### 5. Turn it on
Go to **Actions → Sync Strava runs → Run workflow**. The first run marks the club's existing feed as already seen, so old runs aren't all stamped as today. After that, new runs appear within the hour, and Pages redeploys automatically.

The shared run log keeps working alongside Strava. If a runner has Strava linked, the **Log a run** form reminds them to only log runs Strava missed, so nothing counts twice.
