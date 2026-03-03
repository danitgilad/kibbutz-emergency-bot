// =============================================================================
// Kibbutz Emergency Personnel Bot - Main Server
// =============================================================================
// Express server that receives WhatsApp messages from Twilio webhooks
// and routes them to the bot logic.
// =============================================================================

require("dotenv").config();

const express = require("express");
const { urlencoded } = require("express");
const db = require("./database");
const wa = require("./whatsapp");
const bot = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

// Parse Twilio webhook data (comes as URL-encoded form data)
app.use(urlencoded({ extended: false }));
app.use(express.json());

// =============================================================================
// Middleware: Twilio webhook signature validation
// =============================================================================
function requireTwilioSignature(req, res, next) {
  // Skip validation if BASE_URL is not set (local development)
  if (!process.env.BASE_URL) {
    next();
    return;
  }

  if (!wa.validateTwilioSignature(req)) {
    console.warn(`⚠️ Rejected request with invalid Twilio signature from ${req.ip}`);
    res.status(403).send("Forbidden");
    return;
  }

  next();
}

// =============================================================================
// Middleware: API key protection for admin endpoints
// =============================================================================
function requireApiKey(req, res, next) {
  const configuredKey = process.env.ADMIN_API_KEY;

  if (!configuredKey) {
    res.status(403).json({ error: "Admin endpoints are disabled. Set ADMIN_API_KEY to enable." });
    return;
  }

  const providedKey = req.query.key || req.headers["x-api-key"];
  if (providedKey !== configuredKey) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }

  next();
}

// =============================================================================
// Health check endpoint
// =============================================================================
app.get("/", (req, res) => {
  res.json({
    status: "✅ Kibbutz Emergency Bot is running",
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// Twilio WhatsApp Webhook - receives all incoming messages
// =============================================================================
app.post("/webhook", requireTwilioSignature, async (req, res) => {
  try {
    const from = req.body.From; // e.g., "whatsapp:+972501234567"
    const body = req.body.Body; // The message text
    const numMedia = parseInt(req.body.NumMedia || "0");

    // Ignore media messages (photos, etc.)
    if (!body && numMedia > 0) {
      res.status(200).send("OK");
      return;
    }

    if (!from || !body) {
      res.status(400).send("Missing from or body");
      return;
    }

    // Process the message through our bot logic
    await bot.handleMessage(from, body);

    // Twilio expects a 200 response
    // We send an empty TwiML response (we send messages via the API instead)
    res.set("Content-Type", "text/xml");
    res.send("<Response></Response>");
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.status(500).send("Internal error");
  }
});

// =============================================================================
// Status webhook (optional) - tracks message delivery status
// =============================================================================
app.post("/status", requireTwilioSignature, (req, res) => {
  const messageSid = req.body.MessageSid;
  const status = req.body.MessageStatus;
  console.log(`📊 Message ${messageSid}: ${status}`);
  res.status(200).send("OK");
});

// =============================================================================
// Admin endpoints (protected by API key, phone numbers redacted)
// =============================================================================

// View current roster via browser (phone numbers redacted)
app.get("/roster", requireApiKey, async (req, res) => {
  try {
    const roster = await db.formatRoster();
    // Redact phone numbers from the roster text
    const redacted = roster.replace(/(\+?\d[\d\-\s]{6,})/g, "***-****");
    res.json({ roster: redacted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// View all personnel (phone numbers redacted)
app.get("/personnel", requireApiKey, async (req, res) => {
  try {
    const personnel = await db.getAllPersonnel();
    const redacted = personnel.map((p) => ({
      name: p.name,
      role: p.role,
      status: p.status,
      onCall: p.onCall,
    }));
    res.json({ personnel: redacted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// Start the server
// =============================================================================
async function start() {
  try {
    // Initialize database connection (also restores conversation state)
    await db.init();

    // Initialize Twilio client
    wa.init();

    // Start listening
    app.listen(PORT, () => {
      console.log(`\n🚑 Kibbutz Emergency Bot is running!`);
      console.log(`   Server: http://localhost:${PORT}`);
      console.log(`   Webhook: http://localhost:${PORT}/webhook`);
      console.log(`   Roster:  http://localhost:${PORT}/roster`);
      console.log(`\n   Configure Twilio webhook URL to:`);
      console.log(`   ${process.env.BASE_URL || "https://YOUR_URL"}/webhook\n`);
    });
  } catch (err) {
    console.error("❌ Failed to start:", err);
    process.exit(1);
  }
}

start();
