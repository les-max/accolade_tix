// ============================================================
// Tuck Everlasting — Check-In API (with multi-device sync)
// Google Apps Script — paste into Extensions > Apps Script
// ============================================================

// ---- CONFIGURE THESE TWO VALUES ----
const SHEET_NAME   = "Form Responses"; // JotForm responses tab
const SECRET_KEY   = "tuckeverlasting2026"; // Must match dashboard HTML
// ------------------------------------

const CHECKIN_SHEET_NAME = "CheckIns"; // Auto-created — don't change

const COL_FIRSTNAME = 0; // Column A
const COL_LASTNAME  = 1; // Column B
const COL_EMAIL     = 2; // Column C
const COL_TICKETS   = 3; // Column D

// ── GET: fetch guests + current check-in state ──────────────
function doGet(e) {
  if (!e || !e.parameter || e.parameter.key !== SECRET_KEY) {
    return json({ error: "Unauthorized" });
  }

  try {
    const ss           = SpreadsheetApp.getActiveSpreadsheet();
    const sheet        = ss.getSheetByName(SHEET_NAME);
    const checkinSheet = getOrCreateCheckinSheet(ss);

    const data   = sheet.getDataRange().getValues();
    const guests = [];

    for (let i = 1; i < data.length; i++) {
      const row       = data[i];
      const firstName = (row[COL_FIRSTNAME] || "").toString().trim();
      const lastName  = (row[COL_LASTNAME]  || "").toString().trim();
      const name      = `${firstName} ${lastName}`.trim();
      const email     = (row[COL_EMAIL]     || "").toString().trim();
      const ticketStr = (row[COL_TICKETS]   || "").toString();
      if (!firstName && !lastName || !ticketStr) continue;

      // Generic pattern — matches any "Month D - H(am|pm)" format from JotForm
      const perfMatches = [...ticketStr.matchAll(/([A-Z][a-z]+\s+\d+\s+-\s+\d+(?::\d+)?(?:pm|am))/gi)];
      const qtyMatches  = [...ticketStr.matchAll(/Quantity:\s*(\d+)/gi)];

      for (let j = 0; j < perfMatches.length; j++) {
        const perf = perfMatches[j][1].replace(/\s+/g, ' ').trim();
        const qty  = qtyMatches[j] ? parseInt(qtyMatches[j][1]) : 1;
        guests.push({ name, email, performance: perf, tickets: qty });
      }
    }

    // Load check-in state
    const checkinData = checkinSheet.getDataRange().getValues();
    const checkinMap  = {};
    for (let i = 1; i < checkinData.length; i++) {
      const [key, checkedIn, checkedTime] = checkinData[i];
      if (key) checkinMap[key] = { checked_in: checkedIn === true || checkedIn === "TRUE", checkedTime: checkedTime || null };
    }

    guests.forEach(g => {
      const key    = makeKey(g.name, g.performance);
      const state  = checkinMap[key] || {};
      g.checked_in  = state.checked_in  || false;
      g.checkedTime = state.checkedTime || null;
    });

    // Sort performances chronologically
    const perfSet = [...new Set(guests.map(g => g.performance))].sort((a, b) => {
      const months = { january:1, february:2, march:3, april:4, may:5, june:6,
                       july:7, august:8, september:9, october:10, november:11, december:12 };
      const parse = s => {
        const m = s.match(/([A-Za-z]+)\s+(\d+)\s+-\s+(\d+)(?::(\d+))?(am|pm)/i);
        if (!m) return 0;
        let h = parseInt(m[3]);
        if (m[5].toLowerCase() === 'pm' && h !== 12) h += 12;
        if (m[5].toLowerCase() === 'am' && h === 12) h = 0;
        return (months[m[1].toLowerCase()] || 0) * 10000 + parseInt(m[2]) * 100 + h;
      };
      return parse(a) - parse(b);
    });

    return json({ guests, performances: perfSet, fetchedAt: new Date().toISOString() });

  } catch (err) {
    return json({ error: err.toString() });
  }
}

// ── POST: save a check-in or undo ───────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.key !== SECRET_KEY) return json({ error: "Unauthorized" });

    const { name, performance, checked_in, checkedTime } = body;
    if (!name || !performance) return json({ error: "Missing fields" });

    const ss           = SpreadsheetApp.getActiveSpreadsheet();
    const checkinSheet = getOrCreateCheckinSheet(ss);
    const key          = makeKey(name, performance);

    const data = checkinSheet.getDataRange().getValues();
    let found  = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        checkinSheet.getRange(i + 1, 2, 1, 2).setValues([[checked_in, checkedTime || ""]]);
        found = true;
        break;
      }
    }
    if (!found) {
      checkinSheet.appendRow([key, checked_in, checkedTime || ""]);
    }

    return json({ ok: true });

  } catch (err) {
    return json({ error: err.toString() });
  }
}

// ── Helpers ──────────────────────────────────────────────────
function makeKey(name, performance) {
  return `${name.trim().toLowerCase()}|${performance.trim()}`;
}

function getOrCreateCheckinSheet(ss) {
  let sheet = ss.getSheetByName(CHECKIN_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CHECKIN_SHEET_NAME);
    sheet.appendRow(["key", "checked_in", "checkedTime"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
