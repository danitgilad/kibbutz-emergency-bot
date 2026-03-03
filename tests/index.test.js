// =============================================================================
// Index (Express Server) Tests
// =============================================================================
// Tests webhook validation middleware and admin endpoint protection.
// =============================================================================

const express = require("express");
const request = require("supertest");

// We test the middleware functions in isolation by extracting them
// from the module pattern. Since index.js calls start(), we mock
// the dependencies and test the middleware logic directly.

// --- Mock database ---
jest.mock("../src/database", () => ({
  init: jest.fn().mockResolvedValue(),
  formatRoster: jest.fn().mockResolvedValue(
    "🚨 *CURRENT ON-CALL ROSTER*\n━━━━━━\n🩺 *Doctors:*\n  1. Dr. Sarah — +972-50-111-1111\n━━━━━━\n_Updated: now_"
  ),
  getAllPersonnel: jest.fn().mockResolvedValue([
    { name: "Dr. Sarah", role: "Doctor", phone: "+972-50-111-1111", status: "on_call", onCall: true },
  ]),
}));

// --- Mock whatsapp ---
jest.mock("../src/whatsapp", () => ({
  init: jest.fn(),
  validateTwilioSignature: jest.fn(),
}));

// --- Mock bot ---
jest.mock("../src/bot", () => ({
  handleMessage: jest.fn().mockResolvedValue(),
}));

const db = require("../src/database");
const wa = require("../src/whatsapp");
const bot = require("../src/bot");

// Build a test app that mirrors index.js middleware
function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  function requireTwilioSignature(req, res, next) {
    if (!process.env.BASE_URL) {
      next();
      return;
    }
    if (!wa.validateTwilioSignature(req)) {
      res.status(403).send("Forbidden");
      return;
    }
    next();
  }

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

  app.get("/", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/webhook", requireTwilioSignature, async (req, res) => {
    const from = req.body.From;
    const body = req.body.Body;
    if (!from || !body) {
      res.status(400).send("Missing from or body");
      return;
    }
    await bot.handleMessage(from, body);
    res.set("Content-Type", "text/xml");
    res.send("<Response></Response>");
  });

  app.get("/roster", requireApiKey, async (req, res) => {
    const roster = await db.formatRoster();
    const redacted = roster.replace(/(\+?\d[\d\-\s]{6,})/g, "***-****");
    res.json({ roster: redacted });
  });

  app.get("/personnel", requireApiKey, async (req, res) => {
    const personnel = await db.getAllPersonnel();
    const redacted = personnel.map((p) => ({
      name: p.name,
      role: p.role,
      status: p.status,
      onCall: p.onCall,
    }));
    res.json({ personnel: redacted });
  });

  return app;
}

let app;

beforeAll(() => {
  app = buildApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BASE_URL;
  delete process.env.ADMIN_API_KEY;
});

// --- Health check ---

describe("GET /", () => {
  test("returns ok status", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

// --- Webhook: Twilio signature validation ---

describe("POST /webhook - Twilio validation", () => {
  test("allows request when BASE_URL is not set (dev mode)", async () => {
    const res = await request(app)
      .post("/webhook")
      .type("form")
      .send({ From: "whatsapp:+972501111111", Body: "hi" });

    expect(res.status).toBe(200);
    expect(bot.handleMessage).toHaveBeenCalled();
  });

  test("rejects request with invalid signature when BASE_URL is set", async () => {
    process.env.BASE_URL = "https://example.com";
    wa.validateTwilioSignature.mockReturnValue(false);

    const res = await request(app)
      .post("/webhook")
      .type("form")
      .send({ From: "whatsapp:+972501111111", Body: "hi" });

    expect(res.status).toBe(403);
    expect(bot.handleMessage).not.toHaveBeenCalled();
  });

  test("allows request with valid signature when BASE_URL is set", async () => {
    process.env.BASE_URL = "https://example.com";
    wa.validateTwilioSignature.mockReturnValue(true);

    const res = await request(app)
      .post("/webhook")
      .type("form")
      .send({ From: "whatsapp:+972501111111", Body: "hi" });

    expect(res.status).toBe(200);
    expect(bot.handleMessage).toHaveBeenCalled();
  });

  test("returns 400 for missing fields", async () => {
    const res = await request(app)
      .post("/webhook")
      .type("form")
      .send({ From: "whatsapp:+972501111111" });

    expect(res.status).toBe(400);
  });
});

// --- Admin endpoints: API key protection ---

describe("GET /roster - API key protection", () => {
  test("returns 403 when ADMIN_API_KEY not configured", async () => {
    const res = await request(app).get("/roster");
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("disabled");
  });

  test("returns 401 with wrong key", async () => {
    process.env.ADMIN_API_KEY = "correct-key";
    const res = await request(app).get("/roster?key=wrong-key");
    expect(res.status).toBe(401);
  });

  test("returns roster with correct key (via query param)", async () => {
    process.env.ADMIN_API_KEY = "correct-key";
    const res = await request(app).get("/roster?key=correct-key");
    expect(res.status).toBe(200);
    expect(res.body.roster).toBeDefined();
  });

  test("returns roster with correct key (via header)", async () => {
    process.env.ADMIN_API_KEY = "correct-key";
    const res = await request(app)
      .get("/roster")
      .set("x-api-key", "correct-key");
    expect(res.status).toBe(200);
  });

  test("redacts phone numbers from roster", async () => {
    process.env.ADMIN_API_KEY = "correct-key";
    const res = await request(app).get("/roster?key=correct-key");
    expect(res.body.roster).not.toContain("+972-50-111-1111");
    expect(res.body.roster).toContain("***-****");
  });
});

describe("GET /personnel - API key protection", () => {
  test("returns 401 without key", async () => {
    process.env.ADMIN_API_KEY = "correct-key";
    const res = await request(app).get("/personnel");
    expect(res.status).toBe(401);
  });

  test("redacts phone numbers from personnel", async () => {
    process.env.ADMIN_API_KEY = "correct-key";
    const res = await request(app).get("/personnel?key=correct-key");
    expect(res.status).toBe(200);
    expect(res.body.personnel[0]).not.toHaveProperty("phone");
    expect(res.body.personnel[0]).toHaveProperty("name");
    expect(res.body.personnel[0]).toHaveProperty("role");
  });
});
