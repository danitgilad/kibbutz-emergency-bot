// =============================================================================
// Bot Logic Tests
// =============================================================================
// Tests the message handling flows: leaving, returning, coordinator approval,
// rejection, concurrent approvals, and edge cases.
// =============================================================================

// --- Mock database module ---
const mockDb = {
  findPersonByPhone: jest.fn(),
  getOnCallPersonnel: jest.fn().mockResolvedValue([]),
  getAvailableByRole: jest.fn().mockResolvedValue([]),
  findReplacement: jest.fn().mockResolvedValue(null),
  updatePersonStatus: jest.fn().mockResolvedValue(),
  setOnCall: jest.fn().mockResolvedValue(),
  savePendingChange: jest.fn().mockResolvedValue("CHG-123"),
  updatePendingChange: jest.fn().mockResolvedValue(null),
  getPendingApprovals: jest.fn().mockResolvedValue([]),
  getAllPersonnel: jest.fn().mockResolvedValue([]),
  formatRoster: jest.fn().mockResolvedValue("Mock Roster"),
  normalizePhone: jest.fn((p) => p.replace("whatsapp:", "").replace(/[\s\-\(\)]/g, "")),
  parseRole: jest.fn((input) => {
    const map = { doctor: "Doctor", nurse: "Nurse", paramedic: "Paramedic",
      "רופא": "Doctor", "רופאה": "Doctor", "אח": "Nurse", "אחות": "Nurse",
      "חובש": "Paramedic", "חובשת": "Paramedic" };
    return map[input.trim().toLowerCase()] || null;
  }),
  addPerson: jest.fn().mockResolvedValue(),
  removePerson: jest.fn().mockResolvedValue(),
  getState: jest.fn().mockReturnValue({ step: "main" }),
  setState: jest.fn().mockResolvedValue(),
  clearState: jest.fn().mockResolvedValue(),
};
jest.mock("../src/database", () => mockDb);

// --- Mock WhatsApp module ---
const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(),
  sendMainMenu: jest.fn().mockResolvedValue(),
  sendCoordinatorApproval: jest.fn().mockResolvedValue(),
  sendCoordinatorNotification: jest.fn().mockResolvedValue(),
  sendReplacementOptions: jest.fn().mockResolvedValue(),
  broadcastRoster: jest.fn().mockResolvedValue(),
  sendUserConfirmation: jest.fn().mockResolvedValue(),
};
jest.mock("../src/whatsapp", () => mockWa);

const bot = require("../src/bot");

// =============================================================================
// Test Data
// =============================================================================

const COORDINATOR_PHONE = "whatsapp:+972500000000";
const PERSON_PHONE = "whatsapp:+972501111111";

const mockPerson = {
  name: "Dr. Sarah",
  role: "Doctor",
  phone: "+972-50-111-1111",
  status: "on_call",
  onCall: true,
  rowIndex: 2,
};

const mockReplacement = {
  name: "Dr. Rachel",
  role: "Doctor",
  phone: "+972-50-111-3333",
  status: "available",
  onCall: false,
  rowIndex: 4,
};

beforeAll(() => {
  process.env.COORDINATOR_PHONE = COORDINATOR_PHONE;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.getState.mockReturnValue({ step: "main" });
  mockDb.getPendingApprovals.mockResolvedValue([]);
});

// =============================================================================
// Personnel Flow
// =============================================================================

describe("personnel: unknown number", () => {
  test("sends unrecognized message", async () => {
    mockDb.findPersonByPhone.mockResolvedValue(null);

    await bot.handleMessage(PERSON_PHONE, "hi");

    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      PERSON_PHONE,
      expect.stringContaining("לא מזהה")
    );
  });
});

describe("personnel: menu", () => {
  test("shows menu for 'hi'", async () => {
    mockDb.findPersonByPhone.mockResolvedValue(mockPerson);

    await bot.handleMessage(PERSON_PHONE, "hi");

    expect(mockWa.sendMainMenu).toHaveBeenCalledWith(PERSON_PHONE, "Dr. Sarah");
  });

  test("shows menu for unrecognized command", async () => {
    mockDb.findPersonByPhone.mockResolvedValue(mockPerson);

    await bot.handleMessage(PERSON_PHONE, "foobar");

    expect(mockWa.sendMainMenu).toHaveBeenCalled();
  });
});

describe("personnel: leaving (on-call)", () => {
  beforeEach(() => {
    mockDb.findPersonByPhone.mockResolvedValue(mockPerson);
    mockDb.findReplacement.mockResolvedValue(mockReplacement);
    mockDb.getOnCallPersonnel.mockResolvedValue([mockPerson]);
  });

  test("sends user confirmation", async () => {
    await bot.handleMessage(PERSON_PHONE, "1");

    expect(mockWa.sendUserConfirmation).toHaveBeenCalledWith(PERSON_PHONE, "leaving");
  });

  test("does NOT update status immediately (deferred)", async () => {
    await bot.handleMessage(PERSON_PHONE, "1");

    expect(mockDb.updatePersonStatus).not.toHaveBeenCalled();
  });

  test("saves pending change", async () => {
    await bot.handleMessage(PERSON_PHONE, "1");

    expect(mockDb.savePendingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        personName: "Dr. Sarah",
        replacementName: "Dr. Rachel",
        type: "leaving",
      })
    );
  });

  test("sends coordinator approval request", async () => {
    await bot.handleMessage(PERSON_PHONE, "1");

    expect(mockWa.sendCoordinatorApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        personName: "Dr. Sarah",
        replacementName: "Dr. Rachel",
      }),
      expect.any(String)
    );
  });

  test("sets coordinator state to awaiting_approval", async () => {
    await bot.handleMessage(PERSON_PHONE, "1");

    expect(mockDb.setState).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.objectContaining({
        step: "awaiting_approval",
        changeId: "CHG-123",
        personName: "Dr. Sarah",
      })
    );
  });

  test("works with text alias 'leaving'", async () => {
    await bot.handleMessage(PERSON_PHONE, "leaving");

    expect(mockWa.sendUserConfirmation).toHaveBeenCalledWith(PERSON_PHONE, "leaving");
  });
});

describe("personnel: leaving (not on-call)", () => {
  const offCallPerson = { ...mockPerson, status: "available", onCall: false };

  beforeEach(() => {
    mockDb.findPersonByPhone.mockResolvedValue(offCallPerson);
  });

  test("updates status immediately", async () => {
    await bot.handleMessage(PERSON_PHONE, "1");

    expect(mockDb.updatePersonStatus).toHaveBeenCalledWith(offCallPerson, "out_of_town");
  });

  test("sends notification (not approval) to coordinator", async () => {
    await bot.handleMessage(PERSON_PHONE, "1");

    expect(mockWa.sendCoordinatorNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "leaving", wasOnCall: false })
    );
    expect(mockWa.sendCoordinatorApproval).not.toHaveBeenCalled();
  });
});

describe("personnel: leaving (already out)", () => {
  test("sends already-out message", async () => {
    mockDb.findPersonByPhone.mockResolvedValue({
      ...mockPerson,
      status: "out_of_town",
    });

    await bot.handleMessage(PERSON_PHONE, "1");

    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      PERSON_PHONE,
      expect.stringContaining("כבר מסומן")
    );
    expect(mockDb.updatePersonStatus).not.toHaveBeenCalled();
  });
});

describe("personnel: returning", () => {
  test("updates status to available", async () => {
    const outPerson = { ...mockPerson, status: "out_of_town", onCall: false };
    mockDb.findPersonByPhone.mockResolvedValue(outPerson);

    await bot.handleMessage(PERSON_PHONE, "2");

    expect(mockDb.updatePersonStatus).toHaveBeenCalledWith(outPerson, "available");
    expect(mockWa.sendUserConfirmation).toHaveBeenCalledWith(PERSON_PHONE, "returning");
    expect(mockWa.sendCoordinatorNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "returning" })
    );
  });

  test("sends already-in message if already available", async () => {
    mockDb.findPersonByPhone.mockResolvedValue({
      ...mockPerson,
      status: "available",
      onCall: false,
    });

    await bot.handleMessage(PERSON_PHONE, "2");

    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      PERSON_PHONE,
      expect.stringContaining("כבר מסומן")
    );
  });
});

describe("personnel: view roster", () => {
  test("sends formatted roster", async () => {
    mockDb.findPersonByPhone.mockResolvedValue(mockPerson);

    await bot.handleMessage(PERSON_PHONE, "3");

    expect(mockDb.formatRoster).toHaveBeenCalled();
    expect(mockWa.sendMessage).toHaveBeenCalledWith(PERSON_PHONE, "Mock Roster");
  });
});

// =============================================================================
// Coordinator Flow
// =============================================================================

describe("coordinator: approve", () => {
  const approvalState = {
    step: "awaiting_approval",
    changeId: "CHG-123",
    personName: "Dr. Sarah",
    personPhone: PERSON_PHONE,
    replacementName: "Dr. Rachel",
    replacementPhone: "+972-50-111-3333",
    personRole: "Doctor",
  };

  beforeEach(() => {
    mockDb.getState.mockReturnValue(approvalState);
    mockDb.findPersonByPhone.mockResolvedValue(mockPerson);
    mockDb.getAllPersonnel.mockResolvedValue([mockPerson, mockReplacement]);
  });

  test("updates pending change to approved", async () => {
    await bot.handleMessage(COORDINATOR_PHONE, "1");

    expect(mockDb.updatePendingChange).toHaveBeenCalledWith("CHG-123", "approved");
  });

  test("now applies the deferred status change", async () => {
    await bot.handleMessage(COORDINATOR_PHONE, "1");

    expect(mockDb.updatePersonStatus).toHaveBeenCalledWith(mockPerson, "out_of_town");
  });

  test("sets replacement on-call", async () => {
    mockDb.findPersonByPhone
      .mockResolvedValueOnce(mockPerson) // for the leaving person
      .mockResolvedValueOnce(mockReplacement); // for the replacement

    await bot.handleMessage(COORDINATOR_PHONE, "1");

    expect(mockDb.setOnCall).toHaveBeenCalledWith(mockReplacement, true);
  });

  test("broadcasts roster to all personnel", async () => {
    await bot.handleMessage(COORDINATOR_PHONE, "1");

    expect(mockWa.broadcastRoster).toHaveBeenCalled();
  });

  test("clears coordinator state", async () => {
    await bot.handleMessage(COORDINATOR_PHONE, "1");

    expect(mockDb.clearState).toHaveBeenCalledWith(COORDINATOR_PHONE);
  });

  test("works with text alias 'approve'", async () => {
    await bot.handleMessage(COORDINATOR_PHONE, "approve");

    expect(mockDb.updatePendingChange).toHaveBeenCalledWith("CHG-123", "approved");
  });
});

describe("coordinator: reject", () => {
  const approvalState = {
    step: "awaiting_approval",
    changeId: "CHG-123",
    personName: "Dr. Sarah",
    personPhone: PERSON_PHONE,
    replacementName: "Dr. Rachel",
    replacementPhone: "+972-50-111-3333",
    personRole: "Doctor",
  };

  beforeEach(() => {
    mockDb.getState.mockReturnValue(approvalState);
  });

  test("updates pending change to rejected", async () => {
    await bot.handleMessage(COORDINATOR_PHONE, "2");

    expect(mockDb.updatePendingChange).toHaveBeenCalledWith("CHG-123", "rejected");
  });

  test("does NOT update person status (was never changed)", async () => {
    await bot.handleMessage(COORDINATOR_PHONE, "2");

    expect(mockDb.updatePersonStatus).not.toHaveBeenCalled();
  });

  test("notifies the person", async () => {
    await bot.handleMessage(COORDINATOR_PHONE, "2");

    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      PERSON_PHONE,
      expect.stringContaining("הרכז/ת בדק")
    );
  });
});

describe("coordinator: change replacement", () => {
  const approvalState = {
    step: "awaiting_approval",
    changeId: "CHG-123",
    personName: "Dr. Sarah",
    personPhone: PERSON_PHONE,
    replacementName: "Dr. Rachel",
    replacementPhone: "+972-50-111-3333",
    personRole: "Doctor",
  };

  test("shows available replacements", async () => {
    mockDb.getState.mockReturnValue(approvalState);
    mockDb.getAvailableByRole.mockResolvedValue([mockReplacement]);

    await bot.handleMessage(COORDINATOR_PHONE, "3");

    expect(mockWa.sendReplacementOptions).toHaveBeenCalledWith([mockReplacement]);
    expect(mockDb.setState).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.objectContaining({ step: "choosing_replacement" })
    );
  });

  test("warns if no replacements available", async () => {
    mockDb.getState.mockReturnValue(approvalState);
    mockDb.getAvailableByRole.mockResolvedValue([]);

    await bot.handleMessage(COORDINATOR_PHONE, "3");

    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("אין צוות זמין")
    );
  });
});

describe("coordinator: concurrent approvals (queue)", () => {
  test("queues second request when coordinator is already reviewing", async () => {
    // Coordinator is already reviewing something
    mockDb.getState.mockReturnValue({
      step: "awaiting_approval",
      changeId: "CHG-100",
      personName: "Someone Else",
    });

    const secondPerson = {
      ...mockPerson,
      name: "Dr. Amit",
      phone: "+972-50-111-2222",
    };

    mockDb.findPersonByPhone.mockResolvedValue(secondPerson);
    mockDb.findReplacement.mockResolvedValue(mockReplacement);
    mockDb.getOnCallPersonnel.mockResolvedValue([secondPerson]);

    await bot.handleMessage("whatsapp:+972501112222", "1");

    // Should notify coordinator that it's queued, not overwrite state
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("בתור")
    );
    // Should NOT have called sendCoordinatorApproval (the full approval request)
    expect(mockWa.sendCoordinatorApproval).not.toHaveBeenCalled();
  });
});

describe("coordinator: as personnel", () => {
  test("coordinator can use bot as personnel if they're in the list", async () => {
    mockDb.getState.mockReturnValue({ step: "main" });
    mockDb.findPersonByPhone.mockResolvedValue({
      ...mockPerson,
      phone: COORDINATOR_PHONE.replace("whatsapp:", ""),
    });

    await bot.handleMessage(COORDINATOR_PHONE, "3");

    expect(mockDb.formatRoster).toHaveBeenCalled();
  });
});

// =============================================================================
// Personnel Management (add / remove / init)
// =============================================================================

describe("coordinator: empty list init", () => {
  test("triggers init flow when list is empty", async () => {
    mockDb.getAllPersonnel.mockResolvedValue([]);
    mockDb.getState.mockReturnValue({ step: "main" });

    await bot.handleMessage(COORDINATOR_PHONE, "hi");

    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("ברוכים הבאים")
    );
    expect(mockDb.setState).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.objectContaining({ step: "init_list" })
    );
  });

  test("adds person during init flow", async () => {
    mockDb.getAllPersonnel
      .mockResolvedValueOnce([]) // empty check at top of handleCoordinatorMessage — but state is init_list so skipped
      .mockResolvedValueOnce([{ name: "ד\"ר שרה", role: "Doctor", phone: "+972-50-111-1111" }]); // after adding
    mockDb.getState.mockReturnValue({ step: "init_list" });
    mockDb.findPersonByPhone.mockResolvedValue(null); // no duplicate
    mockDb.parseRole = jest.fn().mockReturnValue("Doctor");

    await bot.handleMessage(COORDINATOR_PHONE, 'ד"ר שרה, Doctor, +972-50-111-1111');

    expect(mockDb.addPerson).toHaveBeenCalledWith("ד\"ר שרה", "Doctor", "+972-50-111-1111");
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("נוסף/ה")
    );
  });

  test("finishes init on 'done'", async () => {
    mockDb.getAllPersonnel.mockResolvedValue([
      { name: "Dr. Sarah", role: "Doctor", phone: "+972-50-111-1111" },
    ]);
    mockDb.getState.mockReturnValue({ step: "init_list" });

    await bot.handleMessage(COORDINATOR_PHONE, "done");

    expect(mockDb.clearState).toHaveBeenCalledWith(COORDINATOR_PHONE);
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("הרשימה מוכנה")
    );
  });
});

describe("coordinator: add command", () => {
  beforeEach(() => {
    mockDb.getAllPersonnel.mockResolvedValue([mockPerson]);
    mockDb.findPersonByPhone.mockResolvedValue(null);
  });

  test("enters adding_person state on 'add'", async () => {
    mockDb.getState.mockReturnValue({ step: "main" });

    await bot.handleMessage(COORDINATOR_PHONE, "add");

    expect(mockDb.setState).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.objectContaining({ step: "adding_person" })
    );
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("הוספת איש/ת צוות")
    );
  });

  test("adds person with valid input", async () => {
    mockDb.getState.mockReturnValue({ step: "adding_person" });
    mockDb.parseRole = jest.fn().mockReturnValue("Nurse");

    await bot.handleMessage(COORDINATOR_PHONE, "אחות מרים, Nurse, +972-50-222-1111");

    expect(mockDb.addPerson).toHaveBeenCalledWith("אחות מרים", "Nurse", "+972-50-222-1111");
    expect(mockDb.clearState).toHaveBeenCalledWith(COORDINATOR_PHONE);
  });

  test("rejects invalid format (missing fields)", async () => {
    mockDb.getState.mockReturnValue({ step: "adding_person" });

    await bot.handleMessage(COORDINATOR_PHONE, "just a name");

    expect(mockDb.addPerson).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("פורמט שגוי")
    );
  });

  test("rejects invalid role", async () => {
    mockDb.getState.mockReturnValue({ step: "adding_person" });
    mockDb.parseRole = jest.fn().mockReturnValue(null);

    await bot.handleMessage(COORDINATOR_PHONE, "שם, pilot, +972-50-111-1111");

    expect(mockDb.addPerson).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("תפקיד לא חוקי")
    );
  });

  test("rejects invalid phone", async () => {
    mockDb.getState.mockReturnValue({ step: "adding_person" });
    mockDb.parseRole = jest.fn().mockReturnValue("Doctor");

    await bot.handleMessage(COORDINATOR_PHONE, "שם, Doctor, 12345");

    expect(mockDb.addPerson).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("טלפון לא חוקי")
    );
  });

  test("rejects duplicate phone", async () => {
    mockDb.getState.mockReturnValue({ step: "adding_person" });
    mockDb.parseRole = jest.fn().mockReturnValue("Doctor");
    mockDb.findPersonByPhone.mockResolvedValue(mockPerson); // duplicate found

    await bot.handleMessage(COORDINATOR_PHONE, "שם, Doctor, +972-50-111-1111");

    expect(mockDb.addPerson).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("כבר קיים")
    );
  });

  test("cancel exits adding_person state", async () => {
    mockDb.getState.mockReturnValue({ step: "adding_person" });

    await bot.handleMessage(COORDINATOR_PHONE, "cancel");

    expect(mockDb.clearState).toHaveBeenCalledWith(COORDINATOR_PHONE);
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("בוטל")
    );
  });
});

describe("coordinator: remove command", () => {
  beforeEach(() => {
    mockDb.getAllPersonnel.mockResolvedValue([mockPerson, mockReplacement]);
  });

  test("enters removing_person state on 'remove'", async () => {
    mockDb.getState.mockReturnValue({ step: "main" });

    await bot.handleMessage(COORDINATOR_PHONE, "remove");

    expect(mockDb.setState).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.objectContaining({ step: "removing_person" })
    );
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("הסרת איש/ת צוות")
    );
  });

  test("triggers init flow instead of remove when list is empty", async () => {
    mockDb.getAllPersonnel.mockResolvedValue([]);
    mockDb.getState.mockReturnValue({ step: "main" });

    await bot.handleMessage(COORDINATOR_PHONE, "remove");

    // Empty list triggers init flow, not the remove flow
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("ברוכים הבאים")
    );
  });

  test("asks confirmation after number selection", async () => {
    mockDb.getState.mockReturnValue({
      step: "removing_person",
      personnelList: [mockPerson, mockReplacement],
    });

    await bot.handleMessage(COORDINATOR_PHONE, "1");

    expect(mockDb.setState).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.objectContaining({
        step: "confirm_remove",
        personToRemove: mockPerson,
      })
    );
  });

  test("removes person on 'yes' confirmation", async () => {
    mockDb.getState.mockReturnValue({
      step: "confirm_remove",
      personToRemove: mockPerson,
    });
    mockDb.findPersonByPhone.mockResolvedValue(mockPerson);

    await bot.handleMessage(COORDINATOR_PHONE, "yes");

    expect(mockDb.removePerson).toHaveBeenCalledWith(mockPerson);
    expect(mockDb.clearState).toHaveBeenCalledWith(COORDINATOR_PHONE);
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("הוסר/ה")
    );
  });

  test("cancels removal on 'no'", async () => {
    mockDb.getState.mockReturnValue({
      step: "confirm_remove",
      personToRemove: mockPerson,
    });

    await bot.handleMessage(COORDINATOR_PHONE, "no");

    expect(mockDb.removePerson).not.toHaveBeenCalled();
    expect(mockDb.clearState).toHaveBeenCalledWith(COORDINATOR_PHONE);
  });
});

describe("coordinator: menu shows add/remove", () => {
  test("coordinator menu includes add and remove options", async () => {
    mockDb.getAllPersonnel.mockResolvedValue([mockPerson]);
    mockDb.getState.mockReturnValue({ step: "main" });
    mockDb.findPersonByPhone.mockResolvedValue(null); // not in personnel list

    await bot.handleMessage(COORDINATOR_PHONE, "menu");

    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("add")
    );
    expect(mockWa.sendMessage).toHaveBeenCalledWith(
      COORDINATOR_PHONE,
      expect.stringContaining("remove")
    );
  });
});
