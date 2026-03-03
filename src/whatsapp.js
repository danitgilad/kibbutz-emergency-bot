// =============================================================================
// WhatsApp Messaging via Twilio
// =============================================================================
// Handles sending messages, interactive buttons, and broadcast notifications
// =============================================================================

const twilio = require("twilio");

let client;
let fromNumber;

function init() {
  client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
  console.log("✅ Twilio client initialized");
}

// --- Send a plain text message ---
async function sendMessage(to, body) {
  try {
    await client.messages.create({
      from: fromNumber,
      to: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
      body: body,
    });
    console.log(`📨 Message sent to ${to}`);
  } catch (err) {
    console.error(`❌ Failed to send message to ${to}:`, err.message);
  }
}

// --- Send the main menu to a user ---
async function sendMainMenu(to, personName) {
  const body =
    `👋 היי ${personName}!\n\n` +
    `מה תרצה/י לעדכן?\n\n` +
    `*1*. 🚗 אני יוצא/ת\n` +
    `*2*. 🏠 חזרתי\n` +
    `*3*. 📋 צפייה בתורנות\n\n` +
    `_השב/י 1, 2 או 3._`;

  await sendMessage(to, body);
}

// --- Send coordinator approval request (on-call person leaving, needs action) ---
async function sendCoordinatorApproval(change, proposedRoster) {
  const coordinatorPhone = process.env.COORDINATOR_PHONE;

  let body =
    `🔔 *בקשת שינוי תורנות*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${change.personName} עזב/ה את הישוב.\n`;

  if (change.replacementName) {
    body +=
      `היה/תה בתורנות.\n\n` +
      `🔄 מחליף/ה מוצע/ת: *${change.replacementName}*\n\n` +
      `*תורנות מוצעת:*\n${proposedRoster}\n\n` +
      `*1*. ✅ אישור\n` +
      `*2*. ❌ דחייה\n` +
      `*3*. ✏️ החלפת מחליף/ה\n\n` +
      `_השב/י 1, 2 או 3._`;
  } else {
    body +=
      `היה/תה בתורנות אבל *אין מחליף/ה זמין/ה* לתפקיד זה.\n\n` +
      `*1*. ✅ אישור (השארת משרה פנויה)\n` +
      `*2*. ❌ דחייה\n\n` +
      `_השב/י 1 או 2._`;
  }

  await sendMessage(coordinatorPhone, body);
}

// --- Send coordinator info-only notification (no action needed) ---
async function sendCoordinatorNotification(change) {
  const coordinatorPhone = process.env.COORDINATOR_PHONE;

  let body;
  if (change.type === "leaving") {
    body =
      `🔔 *עדכון סטטוס*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${change.personName} עזב/ה את הישוב.\n` +
      `לא היה/תה בתורנות — אין צורך במחליף/ה.\n` +
      `הסטטוס עודכן לנעדר/ת.\n\n` +
      `_לא נדרשת פעולה._`;
  } else {
    // returning
    body =
      `🔔 *עדכון סטטוס*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${change.personName} חזר/ה לישוב.\n` +
      `זמין/ה כעת לתורנות.\n\n` +
      `_לא נדרשת פעולה. התורנות ללא שינוי._`;
  }

  await sendMessage(coordinatorPhone, body);
}

// --- Send available replacements list to coordinator ---
async function sendReplacementOptions(availablePersonnel) {
  const coordinatorPhone = process.env.COORDINATOR_PHONE;

  const options = availablePersonnel
    .map((p, i) => `*${i + 1}*. ${p.name} — ${p.phone}`)
    .join("\n");

  const body =
    `👥 *מחליפים זמינים:*\n\n` +
    `${options}\n\n` +
    `_השב/י מספר לבחירה, או הקלד/י *ביטול*._`;

  await sendMessage(coordinatorPhone, body);
}

// --- Broadcast updated roster to ALL personnel ---
async function broadcastRoster(roster, allPersonnel) {
  // roster is already fully formatted by db.formatRoster() — send as-is
  const sendPromises = allPersonnel.map((person) =>
    sendMessage(person.phone, roster)
  );

  await Promise.allSettled(sendPromises);
  console.log(`📢 Roster broadcast sent to ${allPersonnel.length} people`);
}

// --- Send confirmation to the person who reported leaving/back ---
async function sendUserConfirmation(to, type) {
  let body;
  if (type === "leaving") {
    body =
      `🚗 *התקבל!* הסטטוס שלך עודכן.\n\n` +
      `הרכז/ת קיבל/ה הודעה. נסיעה טובה! 👋\n\n` +
      `כשתחזור/י, שלח/י *2* או הקלד/י "חזרתי".`;
  } else {
    body =
      `🏠 *ברוך/ה השב/ה!*\n\n` +
      `הסטטוס שלך עודכן לזמין/ה.\n` +
      `הרכז/ת קיבל/ה הודעה.`;
  }

  await sendMessage(to, body);
}

// --- Validate incoming Twilio webhook signature ---
function validateTwilioSignature(req) {
  const signature = req.headers["x-twilio-signature"];
  if (!signature) return false;

  const url = (process.env.BASE_URL || "") + req.originalUrl;
  const params = req.body || {};

  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params
  );
}

module.exports = {
  init,
  sendMessage,
  sendMainMenu,
  sendCoordinatorApproval,
  sendCoordinatorNotification,
  sendReplacementOptions,
  broadcastRoster,
  sendUserConfirmation,
  validateTwilioSignature,
};
