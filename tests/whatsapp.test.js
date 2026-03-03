// =============================================================================
// WhatsApp Module Tests
// =============================================================================

const mockCreate = jest.fn().mockResolvedValue({ sid: "SM123" });

jest.mock("twilio", () => {
  const mockClient = {
    messages: { create: mockCreate },
  };
  const twilioFn = jest.fn(() => mockClient);
  twilioFn.validateRequest = jest.fn();
  return twilioFn;
});

const twilio = require("twilio");
const wa = require("../src/whatsapp");

beforeAll(() => {
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_WHATSAPP_NUMBER = "whatsapp:+14155238886";
  process.env.COORDINATOR_PHONE = "whatsapp:+972500000000";
  wa.init();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("sendMessage", () => {
  test("sends to whatsapp-prefixed number", async () => {
    await wa.sendMessage("whatsapp:+972501111111", "Hello");

    expect(mockCreate).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+972501111111",
      body: "Hello",
    });
  });

  test("adds whatsapp: prefix if missing", async () => {
    await wa.sendMessage("+972501111111", "Hello");

    expect(mockCreate).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+972501111111",
      body: "Hello",
    });
  });

  test("handles send failure gracefully", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Network error"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    await wa.sendMessage("whatsapp:+972501111111", "Hello");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send"),
      "Network error"
    );
    consoleSpy.mockRestore();
  });
});

describe("broadcastRoster", () => {
  test("sends pre-formatted roster to all personnel without re-wrapping", async () => {
    const roster = "🚨 *CURRENT ON-CALL ROSTER*\n━━━━━━\nDr. Sarah\n━━━━━━\n_Updated: now_";
    const personnel = [
      { phone: "+972-50-111-1111" },
      { phone: "+972-50-222-1111" },
    ];

    await wa.broadcastRoster(roster, personnel);

    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Verify the body is the roster as-is, not double-wrapped
    const firstCallBody = mockCreate.mock.calls[0][0].body;
    expect(firstCallBody).toBe(roster);
    expect(firstCallBody).not.toContain("UPDATED ON-CALL ROSTER");
  });
});

describe("sendCoordinatorApproval", () => {
  test("includes approval options for on-call person with replacement", async () => {
    await wa.sendCoordinatorApproval(
      { personName: "Dr. Sarah", replacementName: "Dr. Rachel", type: "leaving" },
      "Mock Roster"
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = mockCreate.mock.calls[0][0].body;
    expect(body).toContain("בקשת שינוי תורנות");
    expect(body).toContain("Dr. Sarah");
    expect(body).toContain("Dr. Rachel");
    expect(body).toContain("אישור");
    expect(body).toContain("דחייה");
    expect(body).toContain("החלפת מחליף");
  });
});

describe("sendCoordinatorNotification", () => {
  test("sends info-only message for non-on-call leaving", async () => {
    await wa.sendCoordinatorNotification({
      personName: "Nurse Miriam",
      type: "leaving",
    });

    const body = mockCreate.mock.calls[0][0].body;
    expect(body).toContain("עדכון סטטוס");
    expect(body).toContain("לא היה/תה בתורנות");
    expect(body).toContain("לא נדרשת פעולה");
  });

  test("sends info-only message for returning", async () => {
    await wa.sendCoordinatorNotification({
      personName: "Dr. Sarah",
      type: "returning",
    });

    const body = mockCreate.mock.calls[0][0].body;
    expect(body).toContain("חזר/ה לישוב");
    expect(body).toContain("לא נדרשת פעולה");
  });
});

describe("validateTwilioSignature", () => {
  test("returns false when no signature header", () => {
    const req = { headers: {}, originalUrl: "/webhook", body: {} };
    process.env.BASE_URL = "https://example.com";

    const result = wa.validateTwilioSignature(req);
    expect(result).toBe(false);
  });

  test("calls twilio.validateRequest with correct params", () => {
    twilio.validateRequest.mockReturnValue(true);
    process.env.BASE_URL = "https://example.com";

    const req = {
      headers: { "x-twilio-signature": "sig123" },
      originalUrl: "/webhook",
      body: { From: "whatsapp:+972501111111" },
    };

    const result = wa.validateTwilioSignature(req);

    expect(twilio.validateRequest).toHaveBeenCalledWith(
      "test-token",
      "sig123",
      "https://example.com/webhook",
      { From: "whatsapp:+972501111111" }
    );
    expect(result).toBe(true);
  });
});
