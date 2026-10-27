/* Long Run Club — marathon training leaderboard. No build step, no dependencies. */
(() => {
  "use strict";

  const MARATHON = 26.2188;
  const DAY = 86400000;
  const $ = s => document.querySelector(s);
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
  };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let config, runs, stats, events, sortKey = "week", meId = store.get("me", null);
  const now = new Date();

  // ---------- Loading ----------
  async function load() {
    let cfg;
    try {
      const res = await fetch("data/runs.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      cfg = await res.json();
    } catch {
      cfg = structuredClone(window.DEFAULT_CONFIG);
    }
    config = Object.assign(structuredClone(window.DEFAULT_CONFIG), cfg);
    config.plan = Object.assign({}, window.DEFAULT_CONFIG.plan, cfg.plan || {});

    // Real runs = Strava-synced (runs.json) + the shared run log. Sample data only fills an empty board.
    const real = (config.runs || []).concat(await loadShared());
    config.sample = !real.length;
    runs = config.sample ? window.generateSampleRuns(config.runners, now) : real;
    if (!config.race?.date) {
      // No race date set yet: pretend it's ~10 weeks out so the plan maths has something to chew on.
      config.race = Object.assign({}, config.race, { date: isoDay(new Date(+now + 70 * DAY)) });
    }
    // Without a shared log, typed-in runs live on this phone only.
    runs = runs.concat(sharedUrl() ? [] : store.get("manualRuns", []))
      .map(r => ({ ...r, t: parseLocal(r.date) }))
      .filter(r => r.miles > 0 && config.runners.some(x => x.id === r.runner))
      .sort((a, b) => a.t - b.t);
    compute();
    render();
    if (!meId || !config.runners.some(r => r.id === meId)) openWho(true);
    else setTimeout(showPopups, 900);
  }

  // ---------- Shared run log (Google Sheet + Apps Script, see scripts/shared-log.gs) ----------
  let sharedError = false;
  const sharedUrl = () => (config.sharedLog && config.sharedLog.url) || "";
  async function loadShared() {
    if (!sharedUrl()) return [];
    try {
      const res = await fetch(sharedUrl());
      const body = await res.json();
      if (!body.ok) throw new Error(body.error);
      return body.runs.map(r => ({ ...r, miles: +r.miles, seconds: +r.seconds, source: "log" }));
    } catch {
      sharedError = true;
      return [];
    }
  }
  // Apps Script only allows "simple" cross-origin requests, so send JSON as text/plain.
  async function sharedPost(payload) {
    // Without a timeout a dead connection leaves the Save button spinning for a minute.
    const res = await fetch(sharedUrl(), {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20000)
    });
    const body = await res.json().catch(() => { throw new Error("The shared run log sent back something unexpected. Try again in a minute."); });
    if (!body.ok) throw new Error(body.error || "Save failed");
    return body;
  }

  // ---------- Date helpers ----------
  function parseLocal(s) {
    const [d, t = "12:00"] = String(s).split("T");
    const [y, m, dd] = d.split("-").map(Number);
    const [h, mi] = t.split(":").map(Number);
    return new Date(y, m - 1, dd, h || 0, mi || 0);
  }
  function isoDay(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function weekKey(d) { return isoDay(weekStart(d)); }
  function addWeeks(d, n) { const x = new Date(d); x.setDate(x.getDate() + n * 7); return x; }
  function relDay(d) {
    const days = Math.round((weekDayStart(now) - weekDayStart(d)) / DAY);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function weekDayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  // ---------- Formatting ----------
  const mi = n => (Math.round(n * 10) / 10).toFixed(1);
  function hms(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }
  const hm = sec => { const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return `${h}:${String(m).padStart(2, "0")}`; };
  const pace = (sec, miles) => hms(sec / miles) + "/mi";
  const ordinal = n => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  const pick = (arr, key) => arr[Math.abs(hash(key)) % arr.length];

  // ---------- Training-plan maths ----------
  // Where a typical plan (e.g. Hal Higdon / Pfitzinger-style 18 weeks) expects you to be on a given date.
  function planTargets(date) {
    const p = config.plan, race = parseLocal(config.race.date);
    const weeksOut = (race - date) / (7 * DAY);
    const baseWeeks = p.baseWeeks || 0;
    const totalWeeks = baseWeeks + p.weeks;
    const into = totalWeeks - weeksOut;          // weeks elapsed since the plan began
    const buildWeeks = p.weeks - p.taperWeeks;   // build weeks inside the main block
    const lerp = (a, b, f) => a + (b - a) * (isFinite(f) ? Math.max(0, Math.min(1, f)) : 0);
    let weekly, long, phase;
    if (into < baseWeeks) {
      // Base: get out the door consistently. Nobody is "behind" here.
      phase = "base";
      weekly = lerp(p.baseWeeklyMiles, p.startWeeklyMiles, into / baseWeeks);
      long = lerp(p.baseLongRun, p.startLongRun, into / baseWeeks);
    } else if (into < baseWeeks + buildWeeks) {
      phase = "build";
      const f = (into - baseWeeks) / buildWeeks;
      weekly = lerp(p.startWeeklyMiles, p.peakWeeklyMiles, f);
      long = lerp(p.startLongRun, p.peakLongRun, f);
    } else {
      // Taper: the target comes DOWN. Holding it at peak told people to run in race week.
      phase = "taper";
      const f = (into - baseWeeks - buildWeeks) / p.taperWeeks;
      weekly = lerp(p.peakWeeklyMiles, p.taperWeeklyMiles, f);
      long = lerp(p.peakLongRun, p.taperLongRun, f);
    }
    return {
      weekly, long, phase, totalWeeks,
      weekOfPlan: Math.max(1, Math.min(totalWeeks, Math.ceil(into + 0.001))),
      weeksOut
    };
  }
  // Readiness = half weekly volume (4-week average vs. peak-week target), half long run (6-week best vs. 20 mi).
  function readiness(avgWeekly, longest) {
    const p = config.plan;
    const w = Math.min(1, avgWeekly / p.peakWeeklyMiles), l = Math.min(1, longest / p.peakLongRun);
    return { pct: Math.round(50 * w + 50 * l), w, l };
  }

  // Average of two estimates:
  // 1. Riegel, T2 = T1 × (26.2 / D1)^1.07, on the best three 3+ mile runs from the last 6 weeks.
  //    k = 1.07, not the classic 1.06: Vickers & Vertosick (2016) found 1.06 too fast for marathons.
  // 2. Tanda (2011), which predicts from training alone over the last 8 weeks:
  //    pace (s/km) = 17.1 + 140·e^(−0.0053·weekly km) + 0.55·average training pace (s/km).
  //    Needs 3+ weeks of history; until then Riegel stands alone.
  function predict(mine, asOf) {
    const block = mine.filter(r => r.t <= asOf && r.t > +asOf - 56 * DAY && r.seconds > 0);
    const efforts = block.filter(r => r.t > +asOf - 42 * DAY && r.miles >= 3);
    if (!efforts.length) return null;
    const best = efforts.map(r => r.seconds * Math.pow(MARATHON / r.miles, 1.07)).sort((a, b) => a - b).slice(0, 3);
    const riegel = best.reduce((a, b) => a + b, 0) / best.length;
    const weeks = Math.min(8, (asOf - mine[0].t) / (7 * DAY));
    if (weeks < 3) return riegel;
    const km = block.reduce((a, r) => a + r.miles, 0) * 1.609344;
    const avgPace = block.reduce((a, r) => a + r.seconds, 0) / km;
    const tanda = (17.1 + 140 * Math.exp(-0.0053 * (km / weeks)) + 0.55 * avgPace) * 42.195;
    return (riegel + tanda) / 2;
  }

  function streakAt(weeks, upTo) {
    // Weekly streak: consecutive weeks with ≥ N runs. The current week only counts once it's earned,
    // and doesn't break the streak until it's over.
    const need = config.streakRunsPerWeek;
    let wk = weekStart(upTo), n = 0;
    if ((weeks[isoDay(wk)]?.count || 0) >= need) n++;
    wk = addWeeks(wk, -1);
    while ((weeks[isoDay(wk)]?.count || 0) >= need) { n++; wk = addWeeks(wk, -1); }
    return n;
  }

  // ---------- Badges ----------
  const BADGES = [
    { id: "d10", emo: "🔟", name: "Double Digits", desc: "First 10-mile run", test: s => s.run.miles >= 10 },
    { id: "d13", emo: "🌗", name: "Halfway There", desc: "Ran 13.1 miles", test: s => s.run.miles >= 13.1 },
    { id: "d16", emo: "🍭", name: "Sweet Sixteen", desc: "Ran 16 miles", test: s => s.run.miles >= 16 },
    { id: "d18", emo: "🧱", name: "Wall Scout", desc: "Ran 18 miles", test: s => s.run.miles >= 18 },
    { id: "d20", emo: "👑", name: "Twenty Club", desc: "Ran 20 miles", test: s => s.run.miles >= 20 },
    { id: "t100", emo: "💯", name: "Century", desc: "100 total miles", test: s => s.total >= 100 },
    { id: "t250", emo: "🛸", name: "Quarter Grand", desc: "250 total miles", test: s => s.total >= 250 },
    { id: "w30", emo: "🚂", name: "Choo Choo", desc: "30-mile week", test: s => s.week >= 30 },
    { id: "w40", emo: "🌋", name: "Volcano Week", desc: "40-mile week", test: s => s.week >= 40 },
    { id: "s3", emo: "🔥", name: "On Fire", desc: "3-week streak", test: s => s.streak >= 3 },
    { id: "s6", emo: "🤖", name: "Metronome", desc: "6-week streak", test: s => s.streak >= 6 },
    { id: "dawn", emo: "🌅", name: "Dawn Patrol", desc: "Started before 6 am", test: s => s.run.t.getHours() < 6 },
    { id: "fast", emo: "⚡", name: "Zoomies", desc: "3+ mi under 8:00/mi", test: s => s.run.miles >= 3 && s.run.seconds / s.run.miles < 480 }
  ];

  // ---------- Compute everything ----------
  function compute() {
    const thisWeek = weekKey(now), lastWeek = weekKey(addWeeks(now, -1));
    const target = planTargets(now);
    stats = config.runners.map(runner => {
      const mine = runs.filter(r => r.runner === runner.id);
      const weeks = {};
      let total = 0, longestRun = null;
      const earned = {};
      const pbs = [];
      for (const run of mine) {
        const k = weekKey(run.t);
        weeks[k] = weeks[k] || { miles: 0, count: 0 };
        weeks[k].miles += run.miles; weeks[k].count++;
        total += run.miles;
        if (longestRun && run.miles > longestRun.miles) pbs.push(run);
        if (!longestRun || run.miles > longestRun.miles) longestRun = run;
        const state = { run, total, week: weeks[k].miles, streak: streakAt(weeks, run.t) };
        for (const b of BADGES) if (!earned[b.id] && b.test(state)) earned[b.id] = run.t;
      }
      const last28 = mine.filter(r => r.t > +now - 28 * DAY).reduce((a, r) => a + r.miles, 0);
      const long42 = Math.max(0, ...mine.filter(r => r.t > +now - 42 * DAY).map(r => r.miles));
      const avgWeekly = last28 / 4;
      const ready = readiness(avgWeekly, long42);
      const planReady = readiness(target.weekly, target.long);
      const pred = predict(mine, now);
      const predPrev = predict(mine, new Date(+now - 14 * DAY));
      return {
        runner, mine, weeks, total, earned, pbs,
        week: weeks[thisWeek]?.miles || 0,
        weekCount: weeks[thisWeek]?.count || 0,
        lastWeek: weeks[lastWeek]?.miles || 0,
        lastWeekCount: weeks[lastWeek]?.count || 0,
        longest: longestRun ? longestRun.miles : 0,
        streak: streakAt(weeks, now),
        avgWeekly, long42, ready, planReady,
        // No runs yet, or still in the base phase: don't hand anyone a verdict.
        // In the taper the target falls faster than a 4-week average can, so everyone
        // reads "ahead" — including whoever is wrongly still running peak mileage.
        // Comparing volume to target is the wrong frame here, so don't.
        status: !mine.length ? "new"
          : target.phase === "base" ? (ready.pct >= planReady.pct + 5 ? "ahead" : "base")
          : target.phase === "taper" ? "taper"
          : ready.pct >= planReady.pct + 5 ? "ahead"
          : ready.pct <= planReady.pct - 8 ? "behind" : "on",
        pred, predPrev
      };
    });
    // The feed names real people. On sample data every badge and roast would be a
    // fabricated accusation, so show the empty state until someone logs a real run.
    events = config.sample ? [] : buildEvents(lastWeek);
  }

  // ---------- Hype & roasts ----------
  const LINES = {
    pb: [
      "{n} just ran {m} miles — longest run ever. Legs: concerned. Group chat: impressed.",
      "New longest run for {n}: {m} miles. Somewhere a foam roller is bracing itself.",
      "{n} went {m} miles. That's a personal best and probably a personal record for snacks afterwards."
    ],
    badge: {
      d10: "{n} is in double digits now. Single-digit runs are just warmups to them.",
      d13: "{n} ran a half marathon on a random weekend. No medal, no crowd, pure spite.",
      d16: "Sixteen miles for {n}. Officially further than most people drive to brunch.",
      d18: "{n} hit 18 miles and saw the Wall in the distance. Waved. Kept going.",
      d20: "TWENTY. {n} has met the Wall and the Wall blinked first.",
      t100: "{n} crossed 100 total miles. That's like four marathons, but with more laundry.",
      t250: "250 miles for {n}. That's Philly to Boston, give or take a coffee stop.",
      w30: "{n} logged a 30-mile week. The shoes have started requesting PTO.",
      w40: "40-MILE WEEK for {n}. Eat a whole pizza. Doctor's orders (we are not doctors).",
      s3: "{n} is on a 3-week streak. A habit is forming. It's too late to stop now.",
      s6: "6 weeks straight for {n}. Basically a metronome with calves.",
      dawn: "{n} ran before 6 am. The sun wasn't even up. Neither should they have been.",
      fast: "{n} dropped sub-8 pace. Someone check them for a hidden e-bike."
    },
    ghost: [
      "{n} logged zero miles last week. The couch sends its regards.",
      "Missing: {n}. Last seen near a foam roller. If found, please return to the start line.",
      "{n}'s running shoes have filed a missing persons report.",
      "Zero runs from {n} last week. Bold taper strategy, considering the race is {w} weeks away."
    ],
    low: [
      "{n} ran {m} miles last week. Respectfully, that's a warmup.",
      "{n} managed {m} miles last week. Even the dog asked if they were okay.",
      "{m} miles for {n} last week. The plan called. It's not mad, just disappointed."
    ],
    ramp: [
      "{n} jumped {p}% in mileage last week. Jumps over 30% are linked to more running injuries. Your shins would like a word.",
      "{n} went up {p}% last week. Love the energy, but that's how shins start filing complaints. Hold steady this week.",
      "{p}% more miles for {n} last week. Bold. Maybe let the legs catch up before the next jump."
    ],
    champ: [
      "{n} won last week with {m} miles. Everyone else: you have been warned.",
      "Last week's mileage crown goes to {n} ({m} mi). Please bow on the cool-down."
    ]
  };
  const fill = (s, v) => s.replace(/\{(\w)\}/g, (_, k) => v[k]);

  function buildEvents(lastWeek) {
    const out = [];
    const recent = +now - 8 * DAY;
    const lastStart = parseLocal(lastWeek);
    const weeksOut = Math.max(0, Math.round(planTargets(now).weeksOut));
    for (const s of stats) {
      const n = s.runner.name, id = s.runner.id;
      for (const run of s.pbs.filter(r => r.t >= recent)) {
        out.push({ id: `pb-${id}-${run.date}`, kind: "celebrate", runner: s.runner, t: run.t, emo: "🏅",
          title: "New longest run!", body: fill(pick(LINES.pb, id + run.date), { n, m: mi(run.miles) }), weight: 3 });
      }
      for (const b of BADGES) {
        const at = s.earned[b.id];
        if (at && at >= recent) out.push({ id: `badge-${id}-${b.id}`, kind: "celebrate", runner: s.runner, t: at, emo: b.emo,
          title: `Badge: ${b.name}`, body: fill(LINES.badge[b.id], { n }), weight: b.id.startsWith("d") ? 2 : 1 });
      }
      // Only roast people who've actually started training.
      if (s.mine.length && s.mine[0].t < lastStart) {
        const typical = (s.avgWeekly * 4 - s.week) / 4 || s.avgWeekly;
        if (s.lastWeekCount === 0) {
          out.push({ id: `ghost-${id}-${lastWeek}`, kind: "roast", runner: s.runner, t: addWeeks(lastStart, 1), emo: "👻",
            title: "Ghosted!", body: fill(pick(LINES.ghost, id + lastWeek), { n, w: weeksOut }), weight: 2 });
        } else if (s.lastWeek < typical * 0.5) {
          out.push({ id: `low-${id}-${lastWeek}`, kind: "roast", runner: s.runner, t: addWeeks(lastStart, 1), emo: "🐌",
            title: "Light week, huh?", body: fill(pick(LINES.low, id + lastWeek), { n, m: mi(s.lastWeek) }), weight: 1 });
        }
        // Injury guardrail: >30% jump over the previous two weeks' average (Nielsen et al. 2014).
        const base = ([2, 3].reduce((a, k) => a + (s.weeks[weekKey(addWeeks(now, -k))]?.miles || 0), 0)) / 2;
        if (base >= 8 && s.lastWeek > base * 1.3) {
          out.push({ id: `ramp-${id}-${lastWeek}`, kind: "warn", runner: s.runner, t: addWeeks(lastStart, 1), emo: "🦴",
            title: "Easy, tiger", body: fill(pick(LINES.ramp, id + lastWeek), { n, p: Math.round((s.lastWeek / base - 1) * 100) }), weight: 2 });
        }
      }
    }
    const champ = [...stats].sort((a, b) => b.lastWeek - a.lastWeek)[0];
    if (champ && champ.lastWeek > 0) {
      out.push({ id: `champ-${lastWeek}`, kind: "celebrate", runner: champ.runner, t: addWeeks(lastStart, 1), emo: "🏆",
        title: "Last week's champ", body: fill(pick(LINES.champ, lastWeek), { n: champ.runner.name, m: mi(champ.lastWeek) }), weight: 2 });
    }
    return out.sort((a, b) => b.t - a.t);
  }

  // ---------- Rendering ----------
  const SORTS = {
    week: { val: s => s.week, show: s => mi(s.week), unit: "mi this week" },
    total: { val: s => s.total, show: s => Math.round(s.total), unit: "total mi" },
    longest: { val: s => s.longest, show: s => mi(s.longest), unit: "mi longest" },
    streak: { val: s => s.streak * 1000 + s.week, show: s => s.streak, unit: "wk streak" },
    predicted: { val: s => s.pred ? -s.pred : -Infinity, show: s => s.pred ? hm(s.pred) : "—", unit: "predicted" }
  };

  function render() {
    const t = planTargets(now);
    $("#clubName").textContent = config.club;
    document.title = config.club;
    const days = Math.max(0, Math.ceil((parseLocal(config.race.date) - now) / DAY));
    const phaseName = { base: "base building", build: "building", taper: "taper" }[t.phase];
    $("#countdown").textContent = `${config.race.name} in ${days} days · ` +
      `week ${t.weekOfPlan} of ${t.totalWeeks} · ${phaseName}`;
    const me = stats.find(s => s.runner.id === meId);
    const who = $("#whoBtn");
    who.textContent = me ? me.runner.name[0] : "?";
    who.style.background = me ? me.runner.color : "";
    renderStanding(me);
    renderTrack(t);
    renderCards(false);
    renderFeed();
    const synced = config.lastSynced ? `Synced ${relDay(new Date(config.lastSynced))}` : "";
    $("#foot").innerHTML = (sharedError ? "<b>Couldn't load the shared run log.</b> Close and reopen to retry. ·" : "") +
      (config.sample ? "Showing sample data until the first real run · " : "") + esc(synced) +
      ` <button id="resetBtn">Reset pop-ups</button>`;
    $("#resetBtn").onclick = () => { store.set("seen", []); showPopups(); };
  }

  function renderStanding(me) {
    const el = $("#standing");
    if (!me) { el.innerHTML = "Who's winning?<small>Tap the circle up top to pick yourself.</small>"; return; }
    const ranked = [...stats].sort((a, b) => b.week - a.week);
    const pos = ranked.indexOf(me);
    const ahead = ranked[pos - 1], behind = ranked[pos + 1];
    let head, sub;
    if (me.week === 0 && ranked[0].week === 0) {
      head = "Fresh week. <em>Clean slate.</em>";
      sub = "Nobody's run yet. First one out the door gets bragging rights.";
    } else if (pos === 0) {
      head = `You're <em>1st</em> this week`;
      sub = behind ? `${esc(behind.runner.name)} is ${mi(me.week - behind.week)} mi back. Don't get comfy.` : "";
    } else {
      head = `You're <em>${ordinal(pos + 1)}</em> this week`;
      sub = `${mi(ahead.week - me.week)} mi behind ${esc(ahead.runner.name)}` + (pos === 1 ? " for the lead." : ".");
      if (pos === ranked.length - 1) sub += " Lanterne rouge. Lace up.";
    }
    const r = me.ready.pct, statusText = { ahead: "ahead of plan", on: "right on plan", behind: "behind plan", base: "building your base", new: "no runs logged yet", taper: "tapering for race day" }[me.status];
    sub += ` Marathon-ready: ${r}% (${statusText}).`;
    el.innerHTML = `${head}<small>${sub}</small>`;
  }

  function renderTrack(t) {
    const plan = readiness(t.weekly, t.long).pct;
    const track = $("#track");
    track.innerHTML = stats.map((s, i) => `
      <div class="lane">
        <span class="lane-num">${i + 1}</span>
        <div class="lane-inner">
          <span class="plan-tick" style="left:${plan}%"></span>
          <button class="runner-dot${s.runner.id === meId ? " me" : ""}${s.ready.pct > 70 ? " flip" : ""}"
            style="--c:${s.runner.color};left:0" data-left="${s.ready.pct}" data-id="${s.runner.id}"
            aria-label="${esc(s.runner.name)}: ${s.ready.pct}% marathon ready">
            ${esc(s.runner.name[0])}<span class="pct">${s.ready.pct}%</span>
          </button>
        </div>
      </div>`).join("");
    track.setAttribute("aria-label", "Marathon readiness: " + stats.map(s => `${s.runner.name} ${s.ready.pct}%`).join(", "));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      track.querySelectorAll(".runner-dot").forEach(d => { d.style.left = d.dataset.left + "%"; });
    }));
    track.querySelectorAll(".runner-dot").forEach(d => d.onclick = () => openRunner(d.dataset.id));
  }

  function renderCards(animate) {
    const list = $("#cards");
    const sorter = SORTS[sortKey];
    const ranked = [...stats].sort((a, b) => sorter.val(b) - sorter.val(a));
    // FLIP: remember old positions so re-sorting slides cards into place.
    const before = {};
    list.querySelectorAll(".bib").forEach(el => { before[el.dataset.id] = el.getBoundingClientRect().top; });
    list.innerHTML = ranked.map((s, i) => {
      const trend = s.pred && s.predPrev ? s.predPrev - s.pred : 0;
      return `
      <li class="bib${s.runner.id === meId ? " me" : ""}" style="--c:${s.runner.color};${animate ? "animation:none" : `animation-delay:${i * 70}ms`}"
          data-id="${s.runner.id}" tabindex="0" role="button" aria-label="Open ${esc(s.runner.name)}'s details">
        <div class="bib-band"><span>${esc(config.club)}</span><span>#${esc(s.runner.bib || "")}</span></div>
        <div class="bib-main">
          <div class="rank${i === 0 ? " r1" : ""}">${i + 1}</div>
          <div class="who">
            <div class="who-name">${esc(s.runner.name)}</div>
            <div class="who-sub">${s.weekCount} run${s.weekCount === 1 ? "" : "s"} this week</div>
          </div>
          <div class="metric"><div class="metric-val" data-count="${sortKey === "predicted" ? "" : sorter.show(s)}">${sorter.show(s)}</div><div class="metric-unit">${sorter.unit}</div></div>
        </div>
        <div class="chips">
          ${sortKey !== "week" ? `<span class="chip">${mi(s.week)} mi wk</span>` : ""}
          ${sortKey !== "total" ? `<span class="chip">${Math.round(s.total)} mi total</span>` : ""}
          ${sortKey !== "longest" ? `<span class="chip">↔ ${mi(s.longest)} long</span>` : ""}
          ${sortKey !== "streak" ? `<span class="chip${s.streak >= 3 ? " hot" : ""}">🔥 ${s.streak} wk</span>` : ""}
          ${sortKey !== "predicted" && s.pred ? `<span class="chip">⏱ ${hm(s.pred)}${trend > 60 ? " ↓" : ""}</span>` : ""}
        </div>
        <div class="ready">
          <div class="ready-top"><span>Marathon ready ${s.ready.pct}%</span>
            <span class="status ${s.status}">${{ ahead: "Ahead of plan", on: "On plan", behind: "Behind plan", base: "Building base", new: "No runs yet", taper: "Tapering" }[s.status]}</span></div>
          <div class="bar"><div class="bar-fill" data-w="${s.ready.pct}"></div><span class="bar-plan" style="left:${s.planReady.pct}%"></span></div>
        </div>
      </li>`;
    }).join("");

    list.querySelectorAll(".bib").forEach(el => {
      el.onclick = () => openRunner(el.dataset.id);
      el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRunner(el.dataset.id); } };
      if (animate && before[el.dataset.id] != null && !reducedMotion) {
        const dy = before[el.dataset.id] - el.getBoundingClientRect().top;
        if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 500, easing: "cubic-bezier(.34,1.56,.64,1)" });
      }
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      list.querySelectorAll(".bar-fill").forEach(b => { b.style.width = b.dataset.w + "%"; });
    }));
    list.querySelectorAll(".metric-val[data-count]").forEach(countUp);
  }

  function countUp(el) {
    const target = parseFloat(el.dataset.count);
    if (isNaN(target) || reducedMotion) return;
    const decimals = (el.dataset.count.split(".")[1] || "").length;
    const start = performance.now(), dur = 900;
    const step = t => {
      // rAF timestamps can predate `start`, so clamp to avoid a negative first frame.
      const p = Math.max(0, Math.min(1, (t - start) / dur)), e = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * e).toFixed(decimals);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderFeed() {
    const items = events.slice(0, 12);
    $("#feed").innerHTML = items.length ? items.map(e => `
      <li><span class="emo" aria-hidden="true">${e.emo}</span>
        <div><b>${esc(e.title)}</b>${esc(e.body)}<br><time>${relDay(e.t)}</time></div></li>`).join("")
      : `<li><span class="emo">🦗</span><div><b>Quiet out there</b>Log a run to get the hype machine going.</div></li>`;
  }

  // ---------- Bottom sheet ----------
  let lastFocus = null;
  function openSheet(html, onReady) {
    lastFocus = document.activeElement;
    $("#sheetBody").innerHTML = html;
    $("#scrim").hidden = false; $("#sheet").hidden = false;
    $("#sheet").classList.remove("closing"); $("#scrim").classList.remove("closing");
    $("#sheet").scrollTop = 0;
    onReady && onReady($("#sheetBody"));
    const f = $("#sheet").querySelector("button, input");
    f && f.focus({ preventScroll: true });
  }
  function closeSheet() {
    const sheet = $("#sheet"), scrim = $("#scrim");
    if (sheet.hidden) return;
    if (reducedMotion) { sheet.hidden = scrim.hidden = true; return; }
    sheet.classList.add("closing"); scrim.classList.add("closing");
    setTimeout(() => { sheet.hidden = scrim.hidden = true; lastFocus && lastFocus.focus && lastFocus.focus(); }, 220);
  }
  // Tapping away is how you dismiss the keyboard, so the first tap only blurs.
  // Otherwise a half-typed run disappears when you reach for the Done key iOS doesn't give you.
  $("#scrim").onclick = () => {
    const a = document.activeElement;
    if (a && a.matches && a.matches("input, textarea, select")) return a.blur();
    closeSheet();
  };
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
  // Swipe down on the sheet to dismiss.
  (() => {
    let y0 = null;
    const sheet = $("#sheet");
    sheet.addEventListener("touchstart", e => {
      // Never swipe-dismiss off a form control; that throws away what was typed.
      const onField = e.target.closest && e.target.closest("input, textarea, select, button");
      y0 = (sheet.scrollTop <= 0 && !onField) ? e.touches[0].clientY : null;
    }, { passive: true });
    sheet.addEventListener("touchmove", e => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0;
      if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    sheet.addEventListener("touchend", e => {
      if (y0 == null) return;
      const dy = e.changedTouches[0].clientY - y0;
      sheet.style.transform = "";
      if (dy > 110) closeSheet();
      y0 = null;
    });
  })();

  function openRunner(id) {
    const s = stats.find(x => x.runner.id === id);
    const t = planTargets(now);
    const trend = s.pred && s.predPrev ? s.predPrev - s.pred : 0;
    const wkKeys = Array.from({ length: 8 }, (_, i) => weekKey(addWeeks(now, i - 7)));
    const maxWk = Math.max(config.plan.peakWeeklyMiles, ...wkKeys.map(k => s.weeks[k]?.miles || 0));
    const fastest = s.mine.filter(r => r.miles >= 3 && r.seconds).sort((a, b) => a.seconds / a.miles - b.seconds / b.miles)[0];
    openSheet(`
      <div style="--c:${s.runner.color}">
        <h2>${esc(s.runner.name)} <span style="color:var(--muted);font-size:22px">#${esc(s.runner.bib || "")}</span></h2>
        <p class="lede">${s.ready.pct}% marathon ready · ${{ ahead: "ahead of", on: "right on", behind: "behind", base: "building base toward", new: "not started on", taper: "tapering off" }[s.status]} plan (plan says ${s.planReady.pct}% by now)</p>

        <div class="big-pred">
          <div><div class="l">Predicted marathon</div><div class="t">${s.pred ? hms(s.pred) : "—"}</div>
            <div class="l">${s.pred ? pace(s.pred, MARATHON) + " · Riegel + Tanda average, last 8 weeks" : "Log a 3+ mile run to get a prediction"}</div></div>
          ${s.pred && s.predPrev ? `<span class="trend ${trend > 0 ? "up" : ""}">${trend > 0 ? "▼ " + hms(trend) + " faster" : trend < 0 ? "▲ " + hms(-trend) + " slower" : "no change"} vs 2 wks ago</span>` : ""}
        </div>

        <h3>Readiness breakdown</h3>
        <div class="split">
          <div class="stat"><div class="v">${mi(s.avgWeekly)}</div><div class="k">avg mi/week (4 wks) · peak goal ${config.plan.peakWeeklyMiles}, plan now ${Math.round(t.weekly)}</div>
            <div class="mini"><i style="width:${s.ready.w * 100}%"></i></div></div>
          <div class="stat"><div class="v">${mi(s.long42)}</div><div class="k">longest run (6 wks) · goal ${config.plan.peakLongRun}, plan now ${Math.round(t.long)}</div>
            <div class="mini"><i style="width:${s.ready.l * 100}%"></i></div></div>
        </div>

        <h3>Last 8 weeks</h3>
        <div class="weeks">${wkKeys.map((k, i) => {
          const m = s.weeks[k]?.miles || 0;
          return `<div class="${i === 7 ? "now" : ""}"><span>${m ? Math.round(m) : ""}</span><i style="height:${(m / maxWk) * 100}%"></i><span>${i === 7 ? "now" : parseLocal(k).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</span></div>`;
        }).join("")}</div>

        <h3>Badges · ${Object.keys(s.earned).length}/${BADGES.length}</h3>
        <div class="badges">${BADGES.map(b => `
          <div class="badge${s.earned[b.id] ? "" : " locked"}" title="${esc(b.desc)}">
            <span class="b-emo" aria-hidden="true">${b.emo}</span>${esc(b.name)}<br><span style="font-weight:500;color:var(--muted)">${esc(b.desc)}</span></div>`).join("")}</div>

        <h3>Recent runs</h3>
        <ul class="runs">${s.mine.slice(-6).reverse().map(r => `
          <li><span><b>${mi(r.miles)} mi</b> · ${r.seconds ? pace(r.seconds, r.miles) : ""}</span><span>${relDay(r.t)}${r.source === "manual" ? " · this phone" : ""}</span></li>`).join("") || "<li>No runs yet.</li>"}</ul>
        ${fastest ? `<p class="note" style="margin-top:12px">Fastest pace (3+ mi): ${pace(fastest.seconds, fastest.miles)} on ${fastest.t.toLocaleDateString()}</p>` : ""}
        <button class="btn ghost" style="width:100%;margin-top:20px" id="closeSheet">Close</button>
      </div>`, body => { body.querySelector("#closeSheet").onclick = closeSheet; });
  }

  function openWho(first) {
    openSheet(`
      <h2>${first ? "Who's this?" : "Switch runner"}</h2>
      <p class="lede">We'll highlight your bib and tell you exactly who to chase. Saved on this phone only.</p>
      <div class="pick" style="margin-top:18px">${config.runners.map(r =>
        `<button style="--c:${r.color}" data-id="${r.id}" aria-pressed="${r.id === meId}">${esc(r.name)}</button>`).join("")}</div>`,
      body => body.querySelectorAll("[data-id]").forEach(b => b.onclick = () => {
        meId = b.dataset.id; store.set("me", meId);
        closeSheet(); render();
        setTimeout(showPopups, 500);
      }));
  }
  $("#whoBtn").onclick = () => openWho(false);

  // ---------- Log a run ----------
  function parseDuration(s) {
    const str = String(s).trim();
    if (!str) return null;
    // The iOS numeric keypad has no colon key, so accept bare digits as mmss or hmmss.
    if (/^\d+$/.test(str)) {
      if (str.length < 3) return null;
      const d = str.padStart(4, "0");
      return parseDuration([d.slice(0, -4), d.slice(-4, -2), d.slice(-2)].filter(Boolean).join(":"));
    }
    const parts = str.split(":").map(Number);
    if (parts.length < 2 || parts.some(isNaN)) return null;
    if (parts.slice(1).some(p => p < 0 || p >= 60)) return null;
    return parts.reduce((a, p) => a * 60 + p, 0);
  }
  const runnerName = id => config.runners.find(x => x.id === id)?.name || id;
  function newRunId() {
    if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    return (Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 12);
  }
  function openLog() {
    // Read the clock now, not at page load: a Home Screen app can sit in memory for days.
    const nowLog = new Date();
    const today = isoDay(nowLog);
    const shared = !!sharedUrl();
    const local = shared ? [] : store.get("manualRuns", []);
    const logged = shared ? runs.filter(r => r.source === "log" && r.runner === meId).slice(-10).reverse() : [];
    const stravaHint = id => config.runners.find(r => r.id === id)?.strava
      ? "Strava runs sync on their own. Only log runs Strava missed, or they'll count twice." : "";
    openSheet(`
      <h2>Log a run</h2>
      <p class="lede">${shared ? "Shows up for everyone as soon as you save." : "Saved on this phone only until the shared run log is set up."}</p>
      <form class="form" id="logForm" novalidate>
        <div class="pick" role="group" aria-label="Runner">${config.runners.map(r =>
          `<button type="button" style="--c:${r.color}" data-id="${r.id}" aria-pressed="${r.id === meId}">${esc(r.name)}</button>`).join("")}</div>
        <div class="row2">
          <label>Miles<input name="miles" inputmode="decimal" placeholder="6.2" autocomplete="off"></label>
          <label>Time<input name="time" inputmode="numeric" placeholder="5530" autocomplete="off"></label>
        </div>
        <p class="note" id="timeEcho">Time: just the digits. 55 min 30 sec is <b>5530</b>.</p>
        <label>Date<input name="date" type="date" value="${today}" max="${today}"></label>
        <p class="note" id="stravaHint">${stravaHint(meId)}</p>
        <p class="err" id="logErr" role="alert"></p>
        <button class="btn" type="submit">Save run</button>
      </form>
      ${logged.length ? `<h3>Recently logged</h3><ul class="runs">${logged.map(r => `
        <li><span><b>${esc(runnerName(r.runner))}</b> · ${mi(r.miles)} mi · ${relDay(r.t)}</span>
        <button class="del" data-id="${esc(r.id)}">Delete</button></li>`).join("")}</ul>` : ""}
      ${local.length ? `<h3>On this phone</h3><ul class="runs">${local.slice().reverse().map((r, i) => `
        <li><span><b>${esc(runnerName(r.runner))}</b> · ${mi(r.miles)} mi · ${r.date.slice(0, 10)}</span>
        <button class="del" data-i="${local.length - 1 - i}">Delete</button></li>`).join("")}</ul>
        <button class="btn ghost" style="width:100%;margin-top:14px" id="copyJson">Copy as JSON for runs.json</button>` : ""}
    `, body => {
      let who = meId;
      // One id per attempt at saving this run, kept across retries so the log can spot a repeat.
      let pendingId = null;
      body.querySelectorAll(".pick [data-id]").forEach(b => b.onclick = () => {
        who = b.dataset.id;
        body.querySelectorAll(".pick [data-id]").forEach(x => x.setAttribute("aria-pressed", x === b));
        body.querySelector("#stravaHint").textContent = stravaHint(who);
      });
      // Echo back what the digits mean, so nobody has to wonder where the colon went.
      (() => {
        const form = body.querySelector("#logForm"), echo = body.querySelector("#timeEcho");
        const hint = "Time: just the digits. 55 min 30 sec is <b>5530</b>.";
        const update = () => {
          const secs = parseDuration(form.time.value), m = parseFloat(form.miles.value);
          if (!secs) { echo.innerHTML = hint; return; }
          echo.innerHTML = `Reads as <b>${hms(secs)}</b>` + (m > 0 ? ` · ${pace(secs, m)}` : "");
        };
        form.time.oninput = update;
        form.miles.oninput = update;
      })();
      body.querySelector("#logForm").onsubmit = async e => {
        e.preventDefault();
        const f = e.target, err = body.querySelector("#logErr"), btn = f.querySelector("[type=submit]");
        const miles = parseFloat(f.miles.value), seconds = parseDuration(f.time.value);
        if (!who) return err.textContent = "Pick who ran.";
        if (!(miles > 0 && miles < 100)) return err.textContent = "Enter the distance in miles, like 6.2.";
        if (!f.date.value) return err.textContent = "Pick the day you ran.";
        if (!seconds || seconds / miles < 180) return err.textContent = "Enter the time as mm:ss or h:mm:ss, like 55:30 or 5530.";
        if (seconds / miles > 1800) return err.textContent = `That works out to ${pace(seconds, miles)}. Check the time.`;
        const nowSave = new Date();
        const hhmm = f.date.value === isoDay(nowSave) ? `${String(nowSave.getHours()).padStart(2, "0")}:${String(nowSave.getMinutes()).padStart(2, "0")}` : "12:00";
        const run = { runner: who, date: `${f.date.value}T${hhmm}`, miles: Math.round(miles * 100) / 100, seconds, source: shared ? "log" : "manual" };
        if (shared) {
          // Stamp the id here, not on the server: if the reply gets lost and you tap Save
          // again, the same id comes back and the log refuses to write the run twice.
          if (!pendingId) pendingId = newRunId();
          run.id = pendingId;
          btn.disabled = true; btn.textContent = "Saving…"; err.textContent = "";
          try {
            run.id = (await sharedPost({ action: "add", run })).id || run.id;
            pendingId = null;
          } catch (ex) {
            btn.disabled = false; btn.textContent = "Save run";
            // Show what the log actually said; only a real network failure gets the generic message.
            const msg = ex && ex.message && !/Failed to fetch|NetworkError|aborted|timed out/i.test(ex.message)
              ? ex.message : "Couldn't reach the shared run log. Check your connection and try again.";
            return err.textContent = msg;
          }
          // The first real run replaces the sample data.
          if (config.sample) { runs = []; config.sample = false; }
        } else {
          store.set("manualRuns", store.get("manualRuns", []).concat(run));
        }
        closeSheet();
        runs.push({ ...run, t: parseLocal(run.date) });
        runs.sort((a, b) => a.t - b.t);
        compute(); render();
        setTimeout(() => {
          if (!showPopups()) {
            const n = config.runners.find(r => r.id === who).name;
            queuePop([{ id: "logged-" + Date.now(), kind: "celebrate", emo: "👟", title: "Run saved", runner: { color: config.runners.find(r => r.id === who).color },
              body: `${mi(miles)} miles for ${n}. ${pick(["Every mile counts.", "The leaderboard felt that.", "Banked.", "Legs: deposited."], String(Date.now()))}` }]);
          }
        }, 350);
      };
      body.querySelectorAll(".del[data-i]").forEach(b => b.onclick = () => {
        const list = store.get("manualRuns", []);
        list.splice(+b.dataset.i, 1);
        store.set("manualRuns", list);
        location.reload();
      });
      body.querySelectorAll(".del[data-id]").forEach(b => b.onclick = async () => {
        // One stray tap used to wipe a run out of the shared sheet for everyone.
        if (!confirm("Delete this run? It disappears for everyone.")) return;
        b.disabled = true; b.textContent = "Deleting…";
        try {
          await sharedPost({ action: "delete", id: b.dataset.id });
        } catch (ex) {
          // Already gone is the outcome we wanted, not a failure to retry.
          if (!/not found/i.test(ex && ex.message || "")) {
            b.disabled = false; b.textContent = "Retry delete";
            return;
          }
        }
        runs = runs.filter(r => r.id !== b.dataset.id);
        compute(); render(); openLog();
      });
      const copy = body.querySelector("#copyJson");
      if (copy) copy.onclick = async () => {
        const json = JSON.stringify(store.get("manualRuns", []).map(({ source, ...r }) => r), null, 2);
        try { await navigator.clipboard.writeText(json); copy.textContent = "Copied — paste into data/runs.json"; }
        catch { prompt("Copy this:", json); }
      };
    });
  }
  $("#logBtn").onclick = openLog;

  // ---------- Pop-ups ----------
  let popQueue = [];
  function showPopups() {
    // Never celebrate or roast someone over invented runs. Sample data is for
    // showing the shape of the app, not for telling Tolbskii he ghosted a week.
    if (config.sample) return false;
    const seen = new Set(store.get("seen", []));
    const fresh = events.filter(e => !seen.has(e.id)).sort((a, b) => (b.runner.id === meId) - (a.runner.id === meId) || b.weight - a.weight).slice(0, 4);
    // Mark every current event seen so a backlog doesn't spam on the next visit.
    store.set("seen", [...seen, ...events.map(e => e.id)].slice(-400));
    if (!fresh.length) return false;
    queuePop(fresh);
    return true;
  }
  function queuePop(list) {
    const wasEmpty = !popQueue.length;
    popQueue = popQueue.concat(list);
    if (wasEmpty) nextPop();
  }
  function nextPop() {
    const wrap = $("#popWrap"), pop = $("#pop");
    const e = popQueue[0];
    if (!e) { wrap.hidden = true; return; }
    const label = { roast: ["Friendly roast", "Oof. Noted."], warn: ["Coach's note", "Got it, coach"] }[e.kind] || ["Hype alert", "Let's go!"];
    pop.className = "pop" + (e.kind === "celebrate" ? "" : " roast");
    pop.innerHTML = `
      <span class="p-emo" aria-hidden="true">${e.emo}</span>
      <div class="p-kicker">${label[0]}</div>
      <h3>${esc(e.title)}</h3>
      <p>${esc(e.body)}</p>
      <button class="btn" id="popOk">${label[1]}</button>
      ${popQueue.length > 1 ? `<div class="count">${popQueue.length - 1} more</div>` : ""}`;
    wrap.hidden = false;
    // restart the CSS animation
    void pop.offsetWidth;
    $("#popOk").focus();
    $("#popOk").onclick = () => { popQueue.shift(); nextPop(); };
    if (e.kind === "celebrate") confetti(e.runner.color);
  }

  // ---------- Confetti (tiny, dependency-free) ----------
  function confetti(main) {
    if (reducedMotion) return;
    const c = $("#confetti"), ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    const colors = [main, "#C6F432", "#FF5DB1", "#3EE0F0", "#FF8A1F", "#FFFFFF"];
    const bits = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2, y: innerHeight * 0.45,
      vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 4,
      w: 6 + Math.random() * 7, h: 4 + Math.random() * 5,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.vy += 0.45; b.vx *= 0.985; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.fillStyle = b.color; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.cos(b.r * 2));
        ctx.restore();
      }
      if (t - t0 < 2600) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(t0);
  }

  // ---------- Tabs ----------
  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("[data-sort]");
    if (!b || b.dataset.sort === sortKey) return;
    sortKey = b.dataset.sort;
    $("#tabs").querySelectorAll("[data-sort]").forEach(x => x.setAttribute("aria-selected", x === b));
    renderCards(true);
  });

  load();
})();
