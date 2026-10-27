// Fallback config (used if data/runs.json can't be loaded, e.g. opening index.html straight from disk)
// and a generator for 12 weeks of believable sample runs so the app is fun to poke at right away.

window.DEFAULT_CONFIG = {
  club: "Long Run Club",
  race: { name: "OKC Memorial", date: "2027-04-25" },
  plan: {
    baseWeeks: 8, baseWeeklyMiles: 12, baseLongRun: 4,
    weeks: 18, startWeeklyMiles: 20, peakWeeklyMiles: 40, startLongRun: 8, peakLongRun: 20,
    taperWeeks: 3, taperWeeklyMiles: 20, taperLongRun: 8
  },
  streakRunsPerWeek: 3,
  sharedLog: { url: "" },
  runners: [
    { id: "smass",    name: "Smass",    bib: "101", color: "#FF8A1F" },
    { id: "nastie",   name: "Nastie",   bib: "214", color: "#C6F432" },
    { id: "tolbskii", name: "Tolbskii", bib: "333", color: "#FF5DB1" }
  ],
  runs: []
};

window.generateSampleRuns = function (runners, today) {
  // Small seeded PRNG so the sample data is the same on every phone on the same day.
  let seed = 20261027;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Personalities: the steady one, the speedy one, the flaky one, the long-run addict.
  const profiles = [
    { pace: 545, perWeek: 4, longStart: 6, longEnd: 13.3, easy: [3.5, 5.5], miss: [], early: 0.5, improve: 0.05, tempo: false },
    { pace: 470, perWeek: 5, longStart: 7, longEnd: 12, easy: [3.5, 6], miss: [], early: 0.1, improve: 0.03, tempo: true },
    { pace: 590, perWeek: 3, longStart: 5, longEnd: 10, easy: [3, 4.5], miss: [1], early: 0, improve: 0.06, tempo: false },
    { pace: 615, perWeek: 4, longStart: 8, longEnd: 18, easy: [3.5, 5], miss: [6], early: 0.25, improve: 0.03, tempo: false }
  ];
  const WEEKS = 12;
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - (WEEKS - 1) * 7);

  const runs = [];
  runners.forEach((runner, i) => {
    const p = profiles[i % profiles.length];
    for (let w = 0; w < WEEKS; w++) {
      const fromEnd = WEEKS - 1 - w; // 0 = this week, 1 = last full week
      if (p.miss.includes(fromEnd)) continue;
      const progress = Math.min(1, w / (WEEKS - 2));
      const fitness = 1 - p.improve * progress;
      const cutback = w % 4 === 3 ? 0.75 : 1;
      // weekday offsets from Monday: easy runs Tue/Wed/Thu/Mon/Sun, long run Saturday (5)
      const easyDays = [1, 3, 2, 0, 6].slice(0, p.perWeek - 1);
      const plan = easyDays.map(d => ({ d, kind: "easy" })).concat([{ d: 5, kind: "long" }]);
      plan.forEach(({ d, kind }, k) => {
        const date = new Date(monday);
        date.setDate(date.getDate() + w * 7 + d);
        const hour = rand() < p.early ? 5 : 6 + Math.floor(rand() * 13);
        date.setHours(hour, Math.floor(rand() * 60));
        if (date > today) return;
        let miles, pace;
        if (kind === "long") {
          miles = (p.longStart + (p.longEnd - p.longStart) * progress) * cutback;
          pace = p.pace + 45 + rand() * 20;
        } else if (p.tempo && k === 0) {
          miles = 5 + rand() * 2;
          pace = p.pace - 45 + rand() * 10;
        } else {
          miles = p.easy[0] + rand() * (p.easy[1] - p.easy[0]);
          pace = p.pace + rand() * 30;
        }
        miles = Math.round(miles * 100) / 100;
        runs.push({
          runner: runner.id,
          date: toLocalISO(date),
          miles,
          seconds: Math.round(miles * pace * fitness),
          source: "sample"
        });
      });
    }
  });
  return runs;
};

function toLocalISO(d) {
  const z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
