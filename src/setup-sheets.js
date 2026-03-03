// =============================================================================
// Google Sheets Setup Script
// =============================================================================
// Run this ONCE to create the required sheet structure.
// Usage: npm run setup-sheets
// =============================================================================

require("dotenv").config();

const { google } = require("googleapis");
const path = require("path");

async function setup() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const credPath = process.env.GOOGLE_CREDENTIALS_PATH || "./credentials.json";

  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(credPath),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  console.log("📋 Setting up Google Sheets...\n");

  // --- Check existing sheets ---
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = spreadsheet.data.sheets.map(
    (s) => s.properties.title
  );

  // --- Create Personnel sheet ---
  if (!existingSheets.includes("Personnel")) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: "Personnel" },
            },
          },
        ],
      },
    });
    console.log("✅ Created 'Personnel' sheet");
  } else {
    console.log("ℹ️  'Personnel' sheet already exists");
  }

  // --- Create PendingChanges sheet ---
  if (!existingSheets.includes("PendingChanges")) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: "PendingChanges" },
            },
          },
        ],
      },
    });
    console.log("✅ Created 'PendingChanges' sheet");
  } else {
    console.log("ℹ️  'PendingChanges' sheet already exists");
  }

  // --- Create ConversationState sheet ---
  if (!existingSheets.includes("ConversationState")) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: "ConversationState" },
            },
          },
        ],
      },
    });
    console.log("✅ Created 'ConversationState' sheet");
  } else {
    console.log("ℹ️  'ConversationState' sheet already exists");
  }

  // --- Add headers to Personnel sheet ---
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Personnel!A1:F1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["Name", "Role", "Phone", "Status", "OnCall", "LastOnCall"]],
    },
  });
  console.log("✅ Personnel headers set");

  // --- Add headers to PendingChanges sheet ---
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "PendingChanges!A1:H1",
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          "ID",
          "PersonName",
          "PersonPhone",
          "ReplacementName",
          "ReplacementPhone",
          "Timestamp",
          "Status",
          "Type",
        ],
      ],
    },
  });
  console.log("✅ PendingChanges headers set");

  // --- Add headers to ConversationState sheet ---
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "ConversationState!A1:D1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["Phone", "Step", "Data", "UpdatedAt"]],
    },
  });
  console.log("✅ ConversationState headers set");

  // --- Add sample data ---
  const existingData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Personnel!A2:A",
  });

  if (!existingData.data.values || existingData.data.values.length === 0) {
    console.log("\n📝 Adding sample personnel data...");

    const sampleData = [
      // === EDIT THIS SECTION WITH YOUR ACTUAL PERSONNEL ===
      ["Dr. Sarah Cohen",      "Doctor",    "+972-50-111-1111", "on_call",   "TRUE",  ""],
      ["Dr. Amit Levi",        "Doctor",    "+972-50-111-2222", "on_call",   "TRUE",  ""],
      ["Dr. Rachel Ben-David", "Doctor",    "+972-50-111-3333", "available", "FALSE", ""],
      ["Dr. Yossi Katz",       "Doctor",    "+972-50-111-4444", "available", "FALSE", ""],
      ["Nurse Miriam Shapiro", "Nurse",     "+972-50-222-1111", "on_call",   "TRUE",  ""],
      ["Nurse David Peretz",   "Nurse",     "+972-50-222-2222", "on_call",   "TRUE",  ""],
      ["Nurse Tamar Gold",     "Nurse",     "+972-50-222-3333", "available", "FALSE", ""],
      ["Nurse Eli Moshe",      "Nurse",     "+972-50-222-4444", "available", "FALSE", ""],
      ["PM Avi Stern",         "Paramedic", "+972-50-333-1111", "on_call",   "TRUE",  ""],
      ["PM Noa Friedman",      "Paramedic", "+972-50-333-2222", "on_call",   "TRUE",  ""],
      ["PM Gal Alon",          "Paramedic", "+972-50-333-3333", "available", "FALSE", ""],
      ["PM Roni Tal",          "Paramedic", "+972-50-333-4444", "available", "FALSE", ""],
      // === END OF SAMPLE DATA — REPLACE WITH REAL NAMES & NUMBERS ===
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Personnel!A2",
      valueInputOption: "RAW",
      requestBody: { values: sampleData },
    });

    console.log(`✅ Added ${sampleData.length} sample personnel records`);
  } else {
    console.log(
      `ℹ️  Personnel already has data (${existingData.data.values.length} rows) — skipping sample data`
    );
  }

  console.log("\n🎉 Setup complete!\n");
  console.log("Next steps:");
  console.log("  1. Edit the Personnel sheet with your real names & phone numbers");
  console.log("  2. Make sure phone numbers include country code (e.g., +972-50-...)");
  console.log("  3. Set 2 of each role to on_call=TRUE");
  console.log("  4. Run: npm start\n");
}

setup().catch((err) => {
  console.error("❌ Setup failed:", err.message);
  process.exit(1);
});
