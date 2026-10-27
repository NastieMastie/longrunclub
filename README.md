# Long Run Club

A mobile-first marathon-training leaderboard for a small group of friends. It's a static site with no build step: plain HTML, CSS, and JS. It's hosted free on GitHub Pages, and Strava runs are pulled in hourly by a GitHub Action.

```
index.html  styles.css  app.js     ← the app
sample.js                         ← demo data generator + fallback config
data/runs.json                    ← your group: runners, race date, plan, and synced runs
scripts/strava_sync.py            ← pulls new runs from a Strava club
.github/workflows/sync.yml        ← runs the sync every hour and commits new runs
```

## Try it locally
Double-click `index.html`. When the page is opened from disk, the browser blocks reading `data/runs.json`, so it falls back to the built-in sample data. That's fine for poking around. To see your real `runs.json`, serve the folder with any static server, or just push it to GitHub Pages (below).

## Customize your group
Edit `data/runs.json`:
- `runners`: name, bib number, color, and `strava` set to the name **exactly as it appears in your Strava club** (usually `First L.`).
- `race.date`: your marathon date (`YYYY-MM-DD`).
- `plan`: the training-plan targets used by the readiness meter. Defaults to an 18-week plan building to 40 mi/week and a 20-mile long run.
- `useSampleData`: leave this `true` until real runs arrive. The sync flips it to `false` automatically.

## How the numbers work
- **Readiness %** is half weekly volume (your 4-week average vs. the peak-week target) and half long run (your longest run in the last 6 weeks vs. 20 mi). The dashed line shows where the plan expects you to be today.
- **Predicted time** uses Riegel: `T2 = T1 × (26.2 / D1)^1.06`. It averages the best three predictions from 3+ mile runs in the last 6 weeks, then adds up to 6% if your long run is still short, because Riegel is optimistic for under-trained endurance. Training runs are slower than race effort, so treat the number as conservative.
- **Streak** counts consecutive weeks with at least 3 runs. A missed day doesn't break it.

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

## Connect real data (Strava covers Apple Watch + Garmin)

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

To keep the training you've done before syncing started, add those runs by hand to `"runs"` in `data/runs.json`:
```json
{ "runner": "dalton", "date": "2026-10-25T07:30", "miles": 12.4, "seconds": 7020 }
```
The **Log a run** button saves runs on that phone only. Its **Copy as JSON** button gives you exactly this format to paste in.

### Without Strava
- **Apple Health only:** the *Health Auto Export* iOS app can POST workouts to a URL on a schedule. That needs a small backend (e.g. a Cloudflare Worker) that writes to this repo.
- **Garmin only:** Garmin's Health API requires applying to their developer program, which is overkill for 4 friends.
