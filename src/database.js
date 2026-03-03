// =============================================================================
// Google Sheets Database
// =============================================================================
// Uses a Google Sheet as a simple database for the roster.
// Sheet structure:
//   Sheet 1 "Personnel": Name | Role | Phone | Status | OnCall | LastOnCall
//   Sheet 2 "PendingChanges": ID | PersonName | PersonPhone | ReplacementName | ReplacementPhone | Timestamp | Status | Type
//   Sheet 3 "ConversationState": Phone | Step | Data (JSON) | UpdatedAt
// =============================================================================

const { google } = require("googleapis");
const path = require("path");

let sheets;
let spreadsheetId;

// In-memory cache backed by the ConversationState sheet
const conversationStateCache = {};

const TIMEZONE = process.env.TIMEZONE || "Asia/Jerusalem";

// --- Initialize connection to Google Sheets ---
async function init() {
  spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const credPath = process.env.GOOGLE_CREDENTIALS_PATH || "./credentials.json";
  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(credPath),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  sheets = google.sheets({ version: "v4", auth: client });

  console.log("✅ Connected to Google Sheets");

  // Restore conversation state from sheet on startup
  await restoreConversationState();
}

// --- Helper: Read all rows from a sheet ---
async function readSheet(sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });
  return res.data.values || [];
}

// --- Helper: Write a row to a sheet ---
async function appendRow(sheetName, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [values] },
  });
}

// --- Helper: Update a specific cell ---
async function updateCell(sheetName, cell, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!${cell}`,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

// =============================================================================
// Phone Normalization
// =============================================================================

// Normalize any phone to E.164-like format: strip prefix, spaces, dashes, parens
function normalizePhone(phone) {
  return phone
    .replace("whatsapp:", "")
    .replace(/[\s\-\(\)]/g, "");
}

// =============================================================================
// Personnel Functions
// =============================================================================

// Get all personnel as objects
async function getAllPersonnel() {
  const rows = await readSheet("Personnel");
  if (rows.length <= 1) return []; // Only header or empty

  return rows.slice(1).map((row, index) => ({
    rowIndex: index + 2, // 1-indexed, skip header
    name: row[0] || "",
    role: row[1] || "",
    phone: row[2] || "",
    status: row[3] || "available", // available, on_call, out_of_town
    onCall: row[4] === "TRUE" || row[4] === "true",
    lastOnCall: row[5] || "",
  }));
}

// Find a person by their WhatsApp phone number
async function findPersonByPhone(phone) {
  const personnel = await getAllPersonnel();
  const searchNorm = normalizePhone(phone);
  return personnel.find((p) => {
    const pNorm = normalizePhone(p.phone);
    return pNorm === searchNorm;
  }) || null;
}

// Update a person's status
async function updatePersonStatus(person, newStatus) {
  // Status is column D
  await updateCell("Personnel", `D${person.rowIndex}`, newStatus);

  // If going out of town and was on-call, remove from on-call
  if (newStatus === "out_of_town" && person.onCall) {
    await updateCell("Personnel", `E${person.rowIndex}`, "FALSE");
  }
}

// Set a person as on-call and record the timestamp
async function setOnCall(person, isOnCall) {
  await updateCell("Personnel", `E${person.rowIndex}`, isOnCall ? "TRUE" : "FALSE");
  if (isOnCall) {
    await updateCell("Personnel", `D${person.rowIndex}`, "on_call");
    // Track when they were last assigned on-call for fair rotation
    await updateCell("Personnel", `F${person.rowIndex}`, new Date().toISOString());
  }
}

// Get all currently on-call personnel
async function getOnCallPersonnel() {
  const personnel = await getAllPersonnel();
  return personnel.filter((p) => p.onCall);
}

// Get available personnel for a given role (not on-call, not out of town)
async function getAvailableByRole(role) {
  const personnel = await getAllPersonnel();
  return personnel.filter(
    (p) => p.role === role && p.status === "available" && !p.onCall
  );
}

// =============================================================================
// Role Parsing (English + Hebrew input)
// =============================================================================

const ROLE_MAP = {
  doctor: "Doctor",
  nurse: "Nurse",
  paramedic: "Paramedic",
  "רופא": "Doctor",
  "רופאה": "Doctor",
  "אח": "Nurse",
  "אחות": "Nurse",
  "חובש": "Paramedic",
  "חובשת": "Paramedic",
};

// Parse a role string (English or Hebrew) into the canonical English role name
function parseRole(input) {
  return ROLE_MAP[input.trim().toLowerCase()] || null;
}

// =============================================================================
// Personnel Management
// =============================================================================

// Add a new person to the Personnel sheet
async function addPerson(name, role, phone) {
  await appendRow("Personnel", [name, role, phone, "available", "FALSE", ""]);
}

// Remove a person from the Personnel sheet by deleting their row
async function removePerson(person) {
  // Get the sheet ID for Personnel (needed for batchUpdate)
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const personnelSheet = spreadsheet.data.sheets.find(
    (s) => s.properties.title === "Personnel"
  );
  if (!personnelSheet) return;

  const sheetId = personnelSheet.properties.sheetId;

  // Delete the row (0-indexed for the API: rowIndex is 1-indexed, so subtract 1)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: person.rowIndex - 1, // 0-indexed
              endIndex: person.rowIndex,        // exclusive
            },
          },
        },
      ],
    },
  });
}

// Find best replacement: pick the person who was on-call least recently
async function findReplacement(person) {
  const available = await getAvailableByRole(person.role);
  if (available.length === 0) return null;

  // Sort by lastOnCall ascending — empty string (never on-call) comes first
  available.sort((a, b) => {
    if (!a.lastOnCall && !b.lastOnCall) return 0;
    if (!a.lastOnCall) return -1;
    if (!b.lastOnCall) return 1;
    return new Date(a.lastOnCall) - new Date(b.lastOnCall);
  });

  return available[0];
}

// =============================================================================
// Pending Changes Functions
// =============================================================================

// Save a pending change request
async function savePendingChange(change) {
  const id = `CHG-${Date.now()}`;
  await appendRow("PendingChanges", [
    id,
    change.personName,
    change.personPhone,
    change.replacementName || "",
    change.replacementPhone || "",
    new Date().toISOString(),
    "pending",
    change.type || "leaving", // "leaving" or "returning"
  ]);
  return id;
}

// Update a pending change status (approved/rejected)
async function updatePendingChange(changeId, newStatus) {
  const rows = await readSheet("PendingChanges");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === changeId) {
      await updateCell("PendingChanges", `G${i + 1}`, newStatus);
      return {
        id: rows[i][0],
        personName: rows[i][1],
        personPhone: rows[i][2],
        replacementName: rows[i][3],
        replacementPhone: rows[i][4],
        type: rows[i][7] || "leaving",
      };
    }
  }
  return null;
}

// Get all pending changes that need coordinator approval (type=leaving with a replacement)
async function getPendingApprovals() {
  const rows = await readSheet("PendingChanges");
  const pending = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][6] === "pending" && rows[i][3]) {
      // Has status=pending and has a replacement name
      pending.push({
        id: rows[i][0],
        personName: rows[i][1],
        personPhone: rows[i][2],
        replacementName: rows[i][3],
        replacementPhone: rows[i][4],
        timestamp: rows[i][5],
        status: rows[i][6],
        type: rows[i][7] || "leaving",
      });
    }
  }
  return pending;
}

// =============================================================================
// Conversation State (persistent)
// =============================================================================

// Restore all conversation states from the sheet into memory
async function restoreConversationState() {
  try {
    const rows = await readSheet("ConversationState");
    let restored = 0;
    for (let i = 1; i < rows.length; i++) {
      const phone = rows[i][0];
      const step = rows[i][1];
      if (phone && step && step !== "main") {
        try {
          const data = JSON.parse(rows[i][2] || "{}");
          conversationStateCache[phone] = { step, ...data, _rowIndex: i + 1 };
          restored++;
        } catch (e) {
          // Skip corrupted rows
        }
      }
    }
    if (restored > 0) {
      console.log(`🔄 Restored ${restored} pending conversation state(s)`);
    }
  } catch (err) {
    // ConversationState sheet might not exist yet — that's fine
    console.log("ℹ️  No conversation state to restore");
  }
}

// Get conversation state for a phone number
function getState(phone) {
  return conversationStateCache[phone] || { step: "main" };
}

// Set conversation state (updates cache + sheet)
async function setState(phone, state) {
  const { _rowIndex, ...stateData } = state;
  const step = stateData.step || "main";
  const dataJson = JSON.stringify(stateData);
  const now = new Date().toISOString();

  conversationStateCache[phone] = state;

  // Check if row already exists
  const existingRow = conversationStateCache[phone]._rowIndex;
  if (existingRow) {
    // Update existing row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `ConversationState!A${existingRow}:D${existingRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [[phone, step, dataJson, now]] },
    });
  } else {
    // Append new row and record its position
    await appendRow("ConversationState", [phone, step, dataJson, now]);
    // Read back to find the row index
    const rows = await readSheet("ConversationState");
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] === phone) {
        conversationStateCache[phone]._rowIndex = i + 1;
        break;
      }
    }
  }
}

// Clear conversation state
async function clearState(phone) {
  const existing = conversationStateCache[phone];
  delete conversationStateCache[phone];

  if (existing && existing._rowIndex) {
    // Overwrite the row with empty/main state
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `ConversationState!A${existing._rowIndex}:D${existing._rowIndex}`,
      valueInputOption: "RAW",
      requestBody: { values: [[phone, "main", "{}", new Date().toISOString()]] },
    });
  }
}

// =============================================================================
// Roster Formatting
// =============================================================================

// Format the on-call roster as a readable WhatsApp message
async function formatRoster() {
  const onCall = await getOnCallPersonnel();

  const doctors = onCall.filter((p) => p.role === "Doctor");
  const nurses = onCall.filter((p) => p.role === "Nurse");
  const paramedics = onCall.filter((p) => p.role === "Paramedic");

  const formatList = (people) =>
    people.length > 0
      ? people.map((p, i) => `  ${i + 1}. ${p.name} — ${p.phone}`).join("\n")
      : "  ⚠️ לא שובץ אף אחד!";

  return (
    `🚨 *תורנות נוכחית*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🩺 *רופאות/רופאים:*\n${formatList(doctors)}\n\n` +
    `💉 *אחיות/אחים:*\n${formatList(nurses)}\n\n` +
    `🚑 *חובשות/חובשים:*\n${formatList(paramedics)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `_עודכן: ${new Date().toLocaleString("he-IL", { timeZone: TIMEZONE })}_`
  );
}

module.exports = {
  init,
  normalizePhone,
  parseRole,
  getAllPersonnel,
  findPersonByPhone,
  addPerson,
  removePerson,
  updatePersonStatus,
  setOnCall,
  getOnCallPersonnel,
  getAvailableByRole,
  findReplacement,
  savePendingChange,
  updatePendingChange,
  getPendingApprovals,
  getState,
  setState,
  clearState,
  formatRoster,
};
