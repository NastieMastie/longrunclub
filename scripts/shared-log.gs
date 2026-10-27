/**
 * Long Run Club shared run log: a Google Sheet that works as a tiny free database.
 *
 * Setup (once, by the group owner):
 *   1. Create a Google Sheet. Extensions → Apps Script. Replace everything with this file.
 *   2. Edit RUNNERS below to match the "id" values in data/runs.json.
 *   3. Deploy → New deployment → type "Web app".
 *        Execute as: Me
 *        Who has access: Anyone
 *      Approve the permissions prompt (Advanced → Go to project) since it's your own script.
 *   4. Copy the Web app URL (ends in /exec) into "sharedLog": { "url": "..." } in data/runs.json.
 *
 * Runs land in a "Runs" tab. You can fix typos or delete rows right in the sheet.
 * If you change this code later, use Deploy → Manage deployments → Edit → New version,
 * so the URL stays the same.
 */
const RUNNERS = ["smass", "nastie", "tolbskii"];
const HEADERS = ["id", "runner", "date", "miles", "seconds", "addedAt"];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("Runs");
  if (!sh) {
    sh = ss.insertSheet("Runs");
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange("A:C").setNumberFormat("@"); // keep ids and dates as plain text
    sh.getRange("D:D").setNumberFormat("0.00");
    sh.getRange("E:E").setNumberFormat("0");
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  const rows = sheet_().getDataRange().getDisplayValues().slice(1);
  const runs = rows
    .filter(r => r[0] && RUNNERS.indexOf(r[1]) !== -1)
    .map(r => ({ id: r[0], runner: r[1], date: r[2], miles: Number(r[3]), seconds: Number(r[4]) }));
  return json_({ ok: true, runs: runs });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "Bad request" }); }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    if (body.action === "add") {
      const r = body.run || {};
      const miles = Number(r.miles), seconds = Number(r.seconds);
      if (RUNNERS.indexOf(r.runner) === -1) return json_({ ok: false, error: "Unknown runner" });
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.date)) return json_({ ok: false, error: "Bad date" });
      if (!(miles > 0 && miles < 100) || !(seconds > 0 && seconds < 86400)) return json_({ ok: false, error: "Bad distance or time" });
      // The phone stamps the id before it posts. If its reply got lost and it retried,
      // the id is already here, so return it instead of adding the run a second time.
      const id = /^[A-Za-z0-9_-]{6,36}$/.test(String(r.id || "")) ? String(r.id) : Utilities.getUuid().slice(0, 8);
      if (sh.getLastRow() > 1) {
        const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
        for (let i = 0; i < ids.length; i++) {
          if (ids[i][0] === id) return json_({ ok: true, id: id, duplicate: true });
        }
      }
      sh.appendRow([id, r.runner, r.date, Math.round(miles * 100) / 100, Math.round(seconds), new Date().toISOString()]);
      return json_({ ok: true, id: id });
    }
    if (body.action === "delete") {
      const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getDisplayValues();
      for (let i = ids.length - 1; i >= 1; i--) {
        if (ids[i][0] === String(body.id)) { sh.deleteRow(i + 1); return json_({ ok: true }); }
      }
      return json_({ ok: false, error: "Run not found" });
    }
    return json_({ ok: false, error: "Unknown action" });
  } finally {
    lock.releaseLock();
  }
}
