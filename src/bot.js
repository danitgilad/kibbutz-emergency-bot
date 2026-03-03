// =============================================================================
// Bot Logic - Message Handler
// =============================================================================
// Processes incoming WhatsApp messages and routes them to the correct flow:
//   - Regular personnel: leaving, back, view roster
//   - Coordinator: approve, reject, change replacement
//
// State is persisted to the ConversationState sheet so pending approvals
// survive server restarts. Status changes for on-call personnel are deferred
// until coordinator approval. Multiple pending approvals are queued.
// =============================================================================

const db = require("./database");
const wa = require("./whatsapp");

// =============================================================================
// Main message handler - called for every incoming WhatsApp message
// =============================================================================
async function handleMessage(from, body) {
  const message = body.trim().toLowerCase();
  const coordinatorPhone = process.env.COORDINATOR_PHONE;

  // Normalize the "from" number
  const fromNormalized = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
  const isCoordinator = fromNormalized === coordinatorPhone;

  console.log(`📩 Message from ${fromNormalized}: "${body.trim()}"`);

  // --- Route to coordinator flow ---
  if (isCoordinator) {
    await handleCoordinatorMessage(fromNormalized, message, body.trim());
    return;
  }

  // --- Route to regular personnel flow ---
  await handlePersonnelMessage(fromNormalized, message);
}

// =============================================================================
// Personnel Flow
// =============================================================================
async function handlePersonnelMessage(from, message) {
  // Find who this person is
  const person = await db.findPersonByPhone(from);

  if (!person) {
    await wa.sendMessage(
      from,
      "❓ מצטער/ת, לא מזהה את המספר הזה.\n\nאנא פנה/י לרכז/ת כדי להתווסף לרשימת הצוות."
    );
    return;
  }

  // --- Handle numbered menu responses (English + Hebrew aliases) ---
  if (["1", "leaving", "leave", "out", "יוצא", "יוצאת", "עוזב", "עוזבת"].includes(message)) {
    await handleLeaving(from, person);
    return;
  }

  if (["2", "back", "returned", "home", "חזרתי", "חזרה", "בבית"].includes(message)) {
    await handleReturning(from, person);
    return;
  }

  if (["3", "roster", "status", "list", "תורנות", "רשימה"].includes(message)) {
    await handleViewRoster(from);
    return;
  }

  if (["menu", "start", "hi", "hello", "help", "תפריט", "שלום", "היי"].includes(message)) {
    await wa.sendMainMenu(from, person.name);
    return;
  }

  // Default: show menu
  await wa.sendMainMenu(from, person.name);
}

// --- Person is leaving ---
async function handleLeaving(from, person) {
  // Guard: already out of town
  if (person.status === "out_of_town") {
    await wa.sendMessage(
      from,
      "ℹ️ את/ה כבר מסומן/ת כמי שמחוץ לישוב.\n\nכשתחזור/י, שלח/י *2* או הקלד/י \"חזרתי\"."
    );
    return;
  }

  // Confirm to the user immediately — they're done
  await wa.sendUserConfirmation(from, "leaving");

  if (person.onCall) {
    // --- On-call: defer status change until coordinator approval ---
    const replacement = await db.findReplacement(person);

    // Build proposed roster text for coordinator
    const onCall = await db.getOnCallPersonnel();
    const proposed = onCall.filter((p) => p.phone !== person.phone);
    if (replacement) {
      proposed.push({ ...replacement, onCall: true });
    }

    const doctors = proposed.filter((p) => p.role === "Doctor");
    const nurses = proposed.filter((p) => p.role === "Nurse");
    const paramedics = proposed.filter((p) => p.role === "Paramedic");

    const proposedRoster =
      `🩺 ${doctors.map((p) => p.name).join(", ") || "⚠️ אין"}\n` +
      `💉 ${nurses.map((p) => p.name).join(", ") || "⚠️ אין"}\n` +
      `🚑 ${paramedics.map((p) => p.name).join(", ") || "⚠️ אין"}`;

    // Save as pending change (status NOT yet updated in Personnel sheet)
    const changeId = await db.savePendingChange({
      personName: person.name,
      personPhone: from,
      replacementName: replacement ? replacement.name : null,
      replacementPhone: replacement ? replacement.phone : null,
      type: "leaving",
    });

    // Check if coordinator is already reviewing another change
    const coordState = db.getState(process.env.COORDINATOR_PHONE);
    if (coordState.step === "awaiting_approval" || coordState.step === "choosing_replacement") {
      // Queue: notify coordinator that a new request is waiting
      await wa.sendMessage(
        process.env.COORDINATOR_PHONE,
        `🔔 *בתור:* ${person.name} עזב/ה את הישוב (בתורנות). ` +
        `הבקשה תוצג לאישור לאחר הבקשה הנוכחית.`
      );
    } else {
      // Present for approval immediately
      await presentApproval(changeId, person, replacement, proposedRoster);
    }

    console.log(`🚗 ${person.name} is leaving (on-call). Replacement: ${replacement?.name || "none"}. Deferred until approval.`);
  } else {
    // --- Not on-call: apply immediately, no approval needed ---
    await db.updatePersonStatus(person, "out_of_town");

    await db.savePendingChange({
      personName: person.name,
      personPhone: from,
      type: "leaving",
    });

    await wa.sendCoordinatorNotification({
      personName: person.name,
      type: "leaving",
      wasOnCall: false,
    });

    console.log(`🚗 ${person.name} is leaving (not on-call). Status updated immediately.`);
  }
}

// --- Present an approval request to the coordinator ---
async function presentApproval(changeId, person, replacement, proposedRoster) {
  await wa.sendCoordinatorApproval(
    {
      personName: person.name,
      replacementName: replacement ? replacement.name : null,
      type: "leaving",
    },
    proposedRoster
  );

  await db.setState(process.env.COORDINATOR_PHONE, {
    step: "awaiting_approval",
    changeId,
    personName: person.name,
    personPhone: person.phone.startsWith("whatsapp:") ? person.phone : `whatsapp:${db.normalizePhone(person.phone)}`,
    replacementName: replacement ? replacement.name : null,
    replacementPhone: replacement ? replacement.phone : null,
    personRole: person.role,
  });
}

// --- Person is returning ---
async function handleReturning(from, person) {
  // Guard: already available
  if (person.status === "available" || person.status === "on_call") {
    await wa.sendMessage(
      from,
      "ℹ️ את/ה כבר מסומן/ת כנמצא/ת בישוב.\n\nאין צורך בשינוי! שלח/י *3* לצפייה בתורנות הנוכחית."
    );
    return;
  }

  // Returning is safe to apply immediately (no roster impact)
  await db.updatePersonStatus(person, "available");

  // Confirm to the user
  await wa.sendUserConfirmation(from, "returning");

  // Save the change and notify coordinator
  await db.savePendingChange({
    personName: person.name,
    personPhone: from,
    type: "returning",
  });

  await wa.sendCoordinatorNotification({
    personName: person.name,
    type: "returning",
  });

  console.log(`🏠 ${person.name} is back.`);
}

// --- View current roster ---
async function handleViewRoster(from) {
  const roster = await db.formatRoster();
  await wa.sendMessage(from, roster);
}

// =============================================================================
// Coordinator Flow
// =============================================================================
async function handleCoordinatorMessage(from, message, rawMessage) {
  const state = db.getState(from);

  // --- Empty list: guide coordinator through initial setup ---
  const allPersonnel = await db.getAllPersonnel();
  if (allPersonnel.length === 0 && state.step !== "init_list") {
    await wa.sendMessage(
      from,
      `👋 *ברוכים הבאים!*\n\n` +
      `רשימת הצוות ריקה. בוא/י נוסיף אנשים.\n\n` +
      `שלח/י פרטים בפורמט:\n` +
      `*שם, תפקיד, טלפון*\n\n` +
      `תפקידים: Doctor / Nurse / Paramedic\n` +
      `(או בעברית: רופא/ה, אח/אחות, חובש/ת)\n\n` +
      `דוגמה: \`ד"ר שרה כהן, רופא, +972-50-111-1111\`\n\n` +
      `_הקלד/י *done* כשסיימת._`
    );
    await db.setState(from, { step: "init_list" });
    return;
  }

  // --- Init list: adding people one by one ---
  if (state.step === "init_list") {
    if (["done", "סיום"].includes(message)) {
      await db.clearState(from);
      const personnel = await db.getAllPersonnel();
      if (personnel.length === 0) {
        await wa.sendMessage(from, "⚠️ הרשימה עדיין ריקה. שלח/י הודעה כדי להתחיל מחדש.");
      } else {
        const list = personnel.map((p, i) => `${i + 1}. ${p.name} — ${p.role} — ${p.phone}`).join("\n");
        await wa.sendMessage(
          from,
          `✅ *הרשימה מוכנה!* (${personnel.length} אנשים)\n\n${list}\n\n` +
          `_הקלד/י *add* להוספה, *remove* להסרה, או *3* לצפייה בתורנות._`
        );
      }
      return;
    }

    // Try to parse "Name, Role, Phone"
    const result = parsePersonInput(rawMessage);
    if (result.error) {
      await wa.sendMessage(from, result.error);
      return;
    }

    // Check for duplicate phone
    const existing = await db.findPersonByPhone(result.phone);
    if (existing) {
      await wa.sendMessage(from, `⚠️ הטלפון הזה כבר קיים ברשימה (${existing.name}). נסה/י מספר אחר.`);
      return;
    }

    await db.addPerson(result.name, result.role, result.phone);
    const count = (await db.getAllPersonnel()).length;
    await wa.sendMessage(
      from,
      `✅ נוסף/ה: *${result.name}* (${result.role}, ${result.phone})\n` +
      `סה"כ: ${count} אנשים.\n\n` +
      `_שלח/י עוד אחד, או הקלד/י *done* כשסיימת._`
    );
    return;
  }

  // --- Awaiting approval for a roster change ---
  if (state.step === "awaiting_approval") {
    if (["1", "approve", "yes", "אשר", "כן"].includes(message)) {
      await approveChange(state);
      await db.clearState(from);
      await presentNextPending();
      return;
    }

    if (["2", "reject", "no", "דחה", "לא"].includes(message)) {
      await rejectChange(state);
      await db.clearState(from);
      await presentNextPending();
      return;
    }

    if (["3", "change", "replace", "החלף", "שנה"].includes(message)) {
      // Show available replacements
      const available = await db.getAvailableByRole(state.personRole);
      if (available.length === 0) {
        await wa.sendMessage(from, "⚠️ אין צוות זמין נוסף לתפקיד זה. אנא אשר/י או דחה/י.");
        return;
      }

      await wa.sendReplacementOptions(available);
      await db.setState(from, { ...state, step: "choosing_replacement", available });
      return;
    }
  }

  // --- Choosing a different replacement ---
  if (state.step === "choosing_replacement") {
    const num = parseInt(message);
    if (num >= 1 && num <= state.available.length) {
      const chosen = state.available[num - 1];
      state.replacementName = chosen.name;
      state.replacementPhone = chosen.phone;
      await approveChange(state);
      await db.clearState(from);
      await presentNextPending();
      return;
    }

    if (["cancel", "ביטול"].includes(message)) {
      await db.setState(from, { ...state, step: "awaiting_approval" });
      await wa.sendMessage(from, "בוטל. השב/י *1* לאישור, *2* לדחייה, או *3* להחלפת מחליף/ה.");
      return;
    }

    await wa.sendMessage(from, "אנא השב/י עם מספר מהרשימה, או הקלד/י *ביטול*.");
    return;
  }

  // --- Adding a person ---
  if (state.step === "adding_person") {
    if (["cancel", "ביטול"].includes(message)) {
      await db.clearState(from);
      await wa.sendMessage(from, "בוטל.");
      return;
    }

    const result = parsePersonInput(rawMessage);
    if (result.error) {
      await wa.sendMessage(from, result.error);
      return;
    }

    const existing = await db.findPersonByPhone(result.phone);
    if (existing) {
      await wa.sendMessage(from, `⚠️ הטלפון הזה כבר קיים ברשימה (${existing.name}). נסה/י מספר אחר.`);
      return;
    }

    await db.addPerson(result.name, result.role, result.phone);
    await db.clearState(from);
    await wa.sendMessage(
      from,
      `✅ נוסף/ה: *${result.name}* (${result.role}, ${result.phone})`
    );
    return;
  }

  // --- Removing a person: waiting for number selection ---
  if (state.step === "removing_person") {
    if (["cancel", "ביטול"].includes(message)) {
      await db.clearState(from);
      await wa.sendMessage(from, "בוטל.");
      return;
    }

    const num = parseInt(message);
    if (num >= 1 && num <= state.personnelList.length) {
      const chosen = state.personnelList[num - 1];
      await db.setState(from, { step: "confirm_remove", personToRemove: chosen });
      await wa.sendMessage(
        from,
        `האם להסיר את *${chosen.name}* (${chosen.role}, ${chosen.phone})?\n\n` +
        `*yes* — אישור\n*no* — ביטול`
      );
      return;
    }

    await wa.sendMessage(from, "אנא השב/י עם מספר מהרשימה, או הקלד/י *cancel*.");
    return;
  }

  // --- Confirm removal ---
  if (state.step === "confirm_remove") {
    if (["yes", "כן", "y"].includes(message)) {
      const person = await db.findPersonByPhone(state.personToRemove.phone);
      if (person) {
        await db.removePerson(person);
        await wa.sendMessage(from, `✅ *${state.personToRemove.name}* הוסר/ה מהרשימה.`);
      } else {
        await wa.sendMessage(from, "⚠️ לא נמצא/ה ברשימה.");
      }
      await db.clearState(from);
      return;
    }

    if (["no", "לא", "n"].includes(message)) {
      await db.clearState(from);
      await wa.sendMessage(from, "בוטל.");
      return;
    }

    await wa.sendMessage(from, "אנא השב/י *yes* או *no*.");
    return;
  }

  // --- Coordinator commands: add, remove ---
  if (["add", "הוסף"].includes(message)) {
    await db.setState(from, { step: "adding_person" });
    await wa.sendMessage(
      from,
      `➕ *הוספת איש/ת צוות*\n\n` +
      `שלח/י פרטים בפורמט:\n` +
      `*שם, תפקיד, טלפון*\n\n` +
      `תפקידים: Doctor / Nurse / Paramedic\n` +
      `(או בעברית: רופא/ה, אח/אחות, חובש/ת)\n\n` +
      `דוגמה: \`ד"ר שרה כהן, רופא, +972-50-111-1111\`\n\n` +
      `_הקלד/י *cancel* לביטול._`
    );
    return;
  }

  if (["remove", "הסר"].includes(message)) {
    const personnel = await db.getAllPersonnel();
    if (personnel.length === 0) {
      await wa.sendMessage(from, "⚠️ הרשימה ריקה. אין מה להסיר.");
      return;
    }

    const list = personnel.map((p, i) => `*${i + 1}*. ${p.name} — ${p.role} — ${p.phone}`).join("\n");
    await db.setState(from, { step: "removing_person", personnelList: personnel });
    await wa.sendMessage(
      from,
      `➖ *הסרת איש/ת צוות*\n\n${list}\n\n_השב/י מספר לבחירה, או הקלד/י *cancel* לביטול._`
    );
    return;
  }

  // --- Default: coordinator can also use the bot as a regular user ---
  if (["3", "roster", "תורנות", "רשימה"].includes(message)) {
    await handleViewRoster(from);
    return;
  }

  const person = await db.findPersonByPhone(from);
  if (person) {
    await handlePersonnelMessage(from, message);
    return;
  }

  // Show coordinator help
  await wa.sendMessage(
    from,
    `👋 *תפריט רכז/ת*\n\n` +
    `*3*. 📋 צפייה בתורנות\n` +
    `*add* ➕ הוספת איש/ת צוות\n` +
    `*remove* ➖ הסרת איש/ת צוות\n\n` +
    `תקבל/י כאן הודעות כשאנשי צוות מדווחים על יציאה או חזרה.`
  );
}

// =============================================================================
// Helpers
// =============================================================================

// Parse "Name, Role, Phone" input from coordinator
function parsePersonInput(message) {
  // Use the original (non-lowercased) message for name preservation
  // but we receive the lowercased version, so we parse from raw parts
  const parts = message.split(",").map((s) => s.trim());
  if (parts.length < 3) {
    return { error: "⚠️ פורמט שגוי. שלח/י: *שם, תפקיד, טלפון*\n\nדוגמה: `ד\"ר שרה כהן, רופא, +972-50-111-1111`" };
  }

  const name = parts[0];
  const roleInput = parts[1];
  const phone = parts.slice(2).join(",").trim(); // In case phone has commas

  if (!name || name.length < 2) {
    return { error: "⚠️ שם חייב להכיל לפחות 2 תווים." };
  }

  const role = db.parseRole(roleInput);
  if (!role) {
    return { error: "⚠️ תפקיד לא חוקי. השתמש/י ב: Doctor, Nurse, Paramedic\n(או: רופא/ה, אח/אחות, חובש/ת)" };
  }

  // Validate phone: must contain + and at least 8 digits
  const digits = phone.replace(/\D/g, "");
  if (!phone.includes("+") || digits.length < 8) {
    return { error: "⚠️ טלפון לא חוקי. חייב להתחיל ב-+ ולהכיל לפחות 8 ספרות.\n\nדוגמה: `+972-50-111-1111`" };
  }

  return { name, role, phone };
}

// --- Present the next pending approval from the queue ---
async function presentNextPending() {
  const pending = await db.getPendingApprovals();
  if (pending.length === 0) return;

  const next = pending[0];
  const person = await db.findPersonByPhone(next.personPhone);
  if (!person) return;

  const replacement = next.replacementPhone
    ? await db.findPersonByPhone(next.replacementPhone)
    : null;

  // Build proposed roster
  const onCall = await db.getOnCallPersonnel();
  const proposed = onCall.filter((p) => p.phone !== person.phone);
  if (replacement) {
    proposed.push({ ...replacement, onCall: true });
  }

  const doctors = proposed.filter((p) => p.role === "Doctor");
  const nurses = proposed.filter((p) => p.role === "Nurse");
  const paramedics = proposed.filter((p) => p.role === "Paramedic");

  const proposedRoster =
    `🩺 ${doctors.map((p) => p.name).join(", ") || "⚠️ אין"}\n` +
    `💉 ${nurses.map((p) => p.name).join(", ") || "⚠️ אין"}\n` +
    `🚑 ${paramedics.map((p) => p.name).join(", ") || "⚠️ אין"}`;

  await wa.sendMessage(
    process.env.COORDINATOR_PHONE,
    `📋 *בקשה ממתינה הבאה:*`
  );

  await presentApproval(next.id, person, replacement, proposedRoster);
}

// --- Approve a roster change ---
async function approveChange(state) {
  const coordinatorPhone = process.env.COORDINATOR_PHONE;

  // Update the pending change in the database
  await db.updatePendingChange(state.changeId, "approved");

  // NOW apply the deferred status change: mark person as out_of_town and off-call
  const person = await db.findPersonByPhone(state.personPhone);
  if (person) {
    await db.updatePersonStatus(person, "out_of_town");
  }

  // Set the replacement as on-call
  if (state.replacementPhone) {
    const replacement = await db.findPersonByPhone(state.replacementPhone);
    if (replacement) {
      await db.setOnCall(replacement, true);
    }
  }

  // Confirm to coordinator
  await wa.sendMessage(
    coordinatorPhone,
    `✅ *אושר!*\n\nהתורנות עודכנה. שולח לכל הצוות כעת...`
  );

  // Broadcast clean roster to everyone
  const roster = await db.formatRoster();
  const allPersonnel = await db.getAllPersonnel();
  await wa.broadcastRoster(roster, allPersonnel);

  console.log(`✅ Change approved: ${state.personName} → ${state.replacementName}`);
}

// --- Reject a roster change ---
async function rejectChange(state) {
  const coordinatorPhone = process.env.COORDINATOR_PHONE;

  await db.updatePendingChange(state.changeId, "rejected");

  // No status was changed (it was deferred), so nothing to revert
  await wa.sendMessage(coordinatorPhone, "❌ *נדחה.* לא בוצעו שינויים בתורנות.");

  // Notify the person that their change was rejected
  await wa.sendMessage(
    state.personPhone,
    "ℹ️ הרכז/ת בדק/ה את עדכון הסטטוס שלך. אנא צור/י קשר ישירות לפרטים נוספים."
  );

  console.log(`❌ Change rejected for ${state.personName}`);
}

module.exports = { handleMessage };
