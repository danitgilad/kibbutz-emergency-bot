const db = require("../src/database");

// =============================================================================
// Mock Google Sheets API
// =============================================================================
const mockSheetData = {};

const mockSheetsApi = {
  spreadsheets: {
    values: {
      get: jest.fn(async ({ range }) => {
        const sheetName = range.split("!")[0];
        return { data: { values: mockSheetData[sheetName] || [] } };
      }),
      append: jest.fn(async ({ range, requestBody }) => {
        const sheetName = range.split("!")[0];
        if (!mockSheetData[sheetName]) mockSheetData[sheetName] = [];
        mockSheetData[sheetName].push(requestBody.values[0]);
      }),
      update: jest.fn(async ({ range, requestBody }) => {
        const sheetName = range.split("!")[0];
        const cellMatch = range.match(/!([A-Z])(\d+)/);
        if (cellMatch && mockSheetData[sheetName]) {
          const col = cellMatch[1].charCodeAt(0) - 65; // A=0, B=1, ...
          const row = parseInt(cellMatch[2]) - 1; // 0-indexed
          if (mockSheetData[sheetName][row]) {
            // Handle full row updates (e.g., ConversationState!A2:D2)
            if (requestBody.values[0].length > 1) {
              mockSheetData[sheetName][row] = requestBody.values[0];
            } else {
              mockSheetData[sheetName][row][col] = requestBody.values[0][0];
            }
          }
        }
      }),
    },
  },
};

jest.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn().mockImplementation(() => ({
        getClient: jest.fn().mockResolvedValue({}),
      })),
    },
    sheets: jest.fn(() => mockSheetsApi),
  },
}));

// =============================================================================
// Helpers
// =============================================================================

function setPersonnelData(rows) {
  mockSheetData["Personnel"] = [
    ["Name", "Role", "Phone", "Status", "OnCall", "LastOnCall"],
    ...rows,
  ];
}

function setPendingData(rows) {
  mockSheetData["PendingChanges"] = [
    ["ID", "PersonName", "PersonPhone", "ReplacementName", "ReplacementPhone", "Timestamp", "Status", "Type"],
    ...rows,
  ];
}

// =============================================================================
// Tests
// =============================================================================

beforeAll(async () => {
  process.env.GOOGLE_SHEET_ID = "test-sheet-id";
  process.env.GOOGLE_CREDENTIALS_PATH = "./credentials.json";
  mockSheetData["ConversationState"] = [["Phone", "Step", "Data", "UpdatedAt"]];
  await db.init();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSheetData["ConversationState"] = [["Phone", "Step", "Data", "UpdatedAt"]];
});

// --- Phone normalization ---

describe("normalizePhone", () => {
  test("strips whatsapp: prefix", () => {
    expect(db.normalizePhone("whatsapp:+972501111111")).toBe("+972501111111");
  });

  test("strips dashes and spaces", () => {
    expect(db.normalizePhone("+972-50-111-1111")).toBe("+972501111111");
  });

  test("strips parentheses", () => {
    expect(db.normalizePhone("+(972) 50 111 1111")).toBe("+972501111111");
  });

  test("handles already clean number", () => {
    expect(db.normalizePhone("+972501111111")).toBe("+972501111111");
  });
});

// --- findPersonByPhone ---

describe("findPersonByPhone", () => {
  beforeEach(() => {
    setPersonnelData([
      ["Dr. Sarah", "Doctor", "+972-50-111-1111", "on_call", "TRUE", ""],
      ["Nurse Miriam", "Nurse", "+972-50-222-1111", "available", "FALSE", ""],
    ]);
  });

  test("finds person with formatted phone", () => {
    return db.findPersonByPhone("whatsapp:+972501111111").then((person) => {
      expect(person).not.toBeNull();
      expect(person.name).toBe("Dr. Sarah");
    });
  });

  test("returns null for unknown number", () => {
    return db.findPersonByPhone("whatsapp:+972509999999").then((person) => {
      expect(person).toBeNull();
    });
  });

  test("matches regardless of dash formatting", () => {
    return db.findPersonByPhone("whatsapp:+972-50-111-1111").then((person) => {
      expect(person).not.toBeNull();
      expect(person.name).toBe("Dr. Sarah");
    });
  });
});

// --- getAllPersonnel ---

describe("getAllPersonnel", () => {
  test("returns empty array for empty sheet", async () => {
    mockSheetData["Personnel"] = [["Name", "Role", "Phone", "Status", "OnCall", "LastOnCall"]];
    const result = await db.getAllPersonnel();
    expect(result).toEqual([]);
  });

  test("parses personnel rows correctly", async () => {
    setPersonnelData([
      ["Dr. Sarah", "Doctor", "+972-50-111-1111", "on_call", "TRUE", "2024-01-01T00:00:00Z"],
    ]);
    const result = await db.getAllPersonnel();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "Dr. Sarah",
      role: "Doctor",
      phone: "+972-50-111-1111",
      status: "on_call",
      onCall: true,
      lastOnCall: "2024-01-01T00:00:00Z",
      rowIndex: 2,
    });
  });
});

// --- findReplacement (fair rotation) ---

describe("findReplacement", () => {
  test("picks person who was never on-call over someone who was recently", async () => {
    setPersonnelData([
      ["Dr. Sarah", "Doctor", "+972-50-111-1111", "on_call", "TRUE", ""],
      ["Dr. Amit", "Doctor", "+972-50-111-2222", "available", "FALSE", "2024-06-01T00:00:00Z"],
      ["Dr. Rachel", "Doctor", "+972-50-111-3333", "available", "FALSE", ""],
    ]);

    const leaving = { role: "Doctor", phone: "+972-50-111-1111" };
    const replacement = await db.findReplacement(leaving);
    expect(replacement.name).toBe("Dr. Rachel"); // never on-call, should be picked first
  });

  test("picks person who was on-call least recently", async () => {
    setPersonnelData([
      ["Dr. Sarah", "Doctor", "+972-50-111-1111", "on_call", "TRUE", ""],
      ["Dr. Amit", "Doctor", "+972-50-111-2222", "available", "FALSE", "2024-06-01T00:00:00Z"],
      ["Dr. Rachel", "Doctor", "+972-50-111-3333", "available", "FALSE", "2024-01-01T00:00:00Z"],
    ]);

    const leaving = { role: "Doctor", phone: "+972-50-111-1111" };
    const replacement = await db.findReplacement(leaving);
    expect(replacement.name).toBe("Dr. Rachel"); // Jan < Jun, so Rachel picked first
  });

  test("returns null when no replacements available", async () => {
    setPersonnelData([
      ["Dr. Sarah", "Doctor", "+972-50-111-1111", "on_call", "TRUE", ""],
    ]);

    const leaving = { role: "Doctor", phone: "+972-50-111-1111" };
    const replacement = await db.findReplacement(leaving);
    expect(replacement).toBeNull();
  });
});

// --- getAvailableByRole ---

describe("getAvailableByRole", () => {
  test("only returns available, not on-call personnel of the right role", async () => {
    setPersonnelData([
      ["Dr. Sarah", "Doctor", "+972-50-111-1111", "on_call", "TRUE", ""],
      ["Dr. Amit", "Doctor", "+972-50-111-2222", "available", "FALSE", ""],
      ["Nurse Miriam", "Nurse", "+972-50-222-1111", "available", "FALSE", ""],
      ["Dr. Rachel", "Doctor", "+972-50-111-3333", "out_of_town", "FALSE", ""],
    ]);

    const result = await db.getAvailableByRole("Doctor");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dr. Amit");
  });
});

// --- parseRole ---

describe("parseRole", () => {
  test("parses English roles (case-insensitive)", () => {
    expect(db.parseRole("Doctor")).toBe("Doctor");
    expect(db.parseRole("nurse")).toBe("Nurse");
    expect(db.parseRole("PARAMEDIC")).toBe("Paramedic");
  });

  test("parses Hebrew roles", () => {
    expect(db.parseRole("רופא")).toBe("Doctor");
    expect(db.parseRole("רופאה")).toBe("Doctor");
    expect(db.parseRole("אח")).toBe("Nurse");
    expect(db.parseRole("אחות")).toBe("Nurse");
    expect(db.parseRole("חובש")).toBe("Paramedic");
    expect(db.parseRole("חובשת")).toBe("Paramedic");
  });

  test("returns null for invalid role", () => {
    expect(db.parseRole("pilot")).toBeNull();
    expect(db.parseRole("")).toBeNull();
  });
});

// --- addPerson ---

describe("addPerson", () => {
  test("appends a row to Personnel sheet", async () => {
    setPersonnelData([]);

    await db.addPerson("ד\"ר שרה כהן", "Doctor", "+972-50-111-1111");

    expect(mockSheetsApi.spreadsheets.values.append).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "Personnel!A:Z",
        requestBody: {
          values: [["ד\"ר שרה כהן", "Doctor", "+972-50-111-1111", "available", "FALSE", ""]],
        },
      })
    );
  });
});

// --- savePendingChange ---

describe("savePendingChange", () => {
  beforeEach(() => {
    setPendingData([]);
  });

  test("returns a change ID starting with CHG-", async () => {
    const id = await db.savePendingChange({
      personName: "Dr. Sarah",
      personPhone: "whatsapp:+972501111111",
      type: "leaving",
    });
    expect(id).toMatch(/^CHG-\d+$/);
  });
});

// --- Conversation state persistence ---

describe("conversation state", () => {
  test("getState returns main for unknown phone", () => {
    const state = db.getState("whatsapp:+972509999999");
    expect(state).toEqual({ step: "main" });
  });

  test("setState and getState round-trip", async () => {
    await db.setState("whatsapp:+972501111111", {
      step: "awaiting_approval",
      changeId: "CHG-123",
      personName: "Dr. Sarah",
    });

    const state = db.getState("whatsapp:+972501111111");
    expect(state.step).toBe("awaiting_approval");
    expect(state.changeId).toBe("CHG-123");
  });

  test("clearState resets to main", async () => {
    await db.setState("whatsapp:+972501111111", {
      step: "awaiting_approval",
      changeId: "CHG-123",
    });

    await db.clearState("whatsapp:+972501111111");
    const state = db.getState("whatsapp:+972501111111");
    expect(state).toEqual({ step: "main" });
  });
});

// --- formatRoster ---

describe("formatRoster", () => {
  test("includes role sections", async () => {
    setPersonnelData([
      ["Dr. Sarah", "Doctor", "+972-50-111-1111", "on_call", "TRUE", ""],
      ["Nurse Miriam", "Nurse", "+972-50-222-1111", "on_call", "TRUE", ""],
      ["PM Avi", "Paramedic", "+972-50-333-1111", "on_call", "TRUE", ""],
    ]);

    const roster = await db.formatRoster();
    expect(roster).toContain("רופאות/רופאים:");
    expect(roster).toContain("Dr. Sarah");
    expect(roster).toContain("אחיות/אחים:");
    expect(roster).toContain("Nurse Miriam");
    expect(roster).toContain("חובשות/חובשים:");
    expect(roster).toContain("PM Avi");
  });

  test("shows warning when no one is assigned to a role", async () => {
    setPersonnelData([
      ["Dr. Sarah", "Doctor", "+972-50-111-1111", "on_call", "TRUE", ""],
    ]);

    const roster = await db.formatRoster();
    expect(roster).toContain("Dr. Sarah");
    expect(roster).toContain("⚠️ לא שובץ אף אחד!");
  });
});
