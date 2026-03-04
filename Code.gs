// ============================================================
// Frog & Toad Kids — Check-In API (with multi-device sync)
// Google Apps Script — paste into Extensions > Apps Script
// ============================================================

// ---- CONFIGURE THESE TWO VALUES ----
const SHEET_NAME   = "Form Responses"; // Your JotForm responses tab
const SECRET_KEY   = "frogtoad2026";     // Must match your dashboard HTML
// ------------------------------------

const CHECKIN_SHEET_NAME = "CheckIns";   // Auto-created — don't change

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

    // Build guest list from form responses
    const data   = sheet.getDataRange().getValues();
    const guests = [];

    for (let i = 1; i < data.length; i++) {
      const row       = data[i];
      const firstName = (row[COL_FIRSTNAME] || "").toString().trim();
      const lastName  = (row[COL_LASTNAME]  || "").toString().trim();
      const name      = `${firstName} ${lastName}`.trim();
      const email     = (row[COL_EMAIL]     || "").toString().trim();
      const ticketStr = (row[COL_TICKETS] || "").toString();
      if (!firstName && !lastName || !ticketStr) continue;

      const perfMatches = [...ticketStr.matchAll(/(March\s+\d+\s+-\s+\d+(?:pm|am))/gi)];
      const qtyMatches  = [...ticketStr.matchAll(/Quantity:\s*(\d+)/gi)];

      for (let j = 0; j < perfMatches.length; j++) {
        const perf = perfMatches[j][1].replace(/\s+/g, ' ').trim();
        const qty  = qtyMatches[j] ? parseInt(qtyMatches[j][1]) : 1;
        guests.push({ name, email, performance: perf, tickets: qty });
      }
    }

    // Load check-in state from CheckIns sheet
    // Format: key (name|performance), checkedIn (TRUE/FALSE), checkedTime
    const checkinData = checkinSheet.getDataRange().getValues();
    const checkinMap  = {};
    for (let i = 1; i < checkinData.length; i++) {
      const [key, checkedIn, checkedTime] = checkinData[i];
      if (key) checkinMap[key] = { checked_in: checkedIn === true || checkedIn === "TRUE", checkedTime: checkedTime || null };
    }

    // Merge check-in state into guests
    guests.forEach(g => {
      const key    = makeKey(g.name, g.performance);
      const state  = checkinMap[key] || {};
      g.checked_in  = state.checked_in  || false;
      g.checkedTime = state.checkedTime || null;
    });

    // Sorted performance list
    const perfSet = [...new Set(guests.map(g => g.performance))].sort((a, b) => {
      const dayA = parseInt(a.match(/\d+/)[0]);
      const dayB = parseInt(b.match(/\d+/)[0]);
      if (dayA !== dayB) return dayA - dayB;
      const order = { '12pm': 0, '2pm': 1, '3pm': 2, '7pm': 3 };
      const tA = (a.match(/\d+(?:pm|am)/i) || ['7pm'])[0].toLowerCase();
      const tB = (b.match(/\d+(?:pm|am)/i) || ['7pm'])[0].toLowerCase();
      return (order[tA] ?? 9) - (order[tB] ?? 9);
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

    // Find existing row or append new one
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
