# Deployment Guide - Kibbutz Emergency Bot

Step-by-step instructions to get the bot running. No advanced technical knowledge required.

---

## Prerequisites

- A computer with internet access
- A Google account (Gmail)
- A phone with WhatsApp
- A credit card (for Twilio account - costs ~$1-5/month)

> **Want to try without Twilio first?** Set `DEMO_MODE=true` in your `.env` file. Messages will be logged to the console instead of sent via WhatsApp.

---

## Step 1: Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Create a new blank spreadsheet
3. Name it something like "Kibbutz Emergency Roster"
4. Copy the **Sheet ID** from the URL in the browser - it's the long string between `/d/` and `/edit`:
   ```
   https://docs.google.com/spreadsheets/d/THE_ID_IS_HERE/edit
   ```
5. Save this ID - you'll need it later

---

## Step 2: Set Up a Google Cloud Service Account

This gives the bot permission to read and write to your Google Sheet.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project** at the top > **New Project**
3. Name it (e.g. "kibbutz-bot") and click **Create**
4. Enable the **Google Sheets API**:
   - In the sidebar: **APIs & Services** > **Library**
   - Search for "Google Sheets API"
   - Click **Enable**
5. Create a Service Account:
   - Go to **APIs & Services** > **Credentials**
   - Click **Create Credentials** > **Service Account**
   - Name it "kibbutz-bot" and click **Done**
6. Create a key:
   - Click on the service account you just created
   - Go to the **Keys** tab
   - Click **Add Key** > **Create new key** > **JSON**
   - A file will download - rename it to `credentials.json`
7. Share the Google Sheet with the service account:
   - Copy the service account email (looks like: `kibbutz-bot@project-name.iam.gserviceaccount.com`)
   - Open your Google Sheet
   - Click **Share**, paste the email, give it **Editor** access

---

## Step 3: Set Up Twilio (WhatsApp Service)

1. Go to [twilio.com](https://www.twilio.com) and create a free account
2. After signing up, go to the [Twilio Console](https://console.twilio.com)
3. Note your **Account SID** and **Auth Token** (shown on the main dashboard)
4. Set up the WhatsApp Sandbox (for testing):
   - Go to **Messaging** > **Try it out** > **Send a WhatsApp message**
   - Follow the instructions to connect your phone to the Sandbox
   - Note the Sandbox number (e.g. `+1 415 523 8886`)

---

## Step 4: Generate an Admin API Key

Run this command on your computer (in a terminal):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Save the output - this will be your `ADMIN_API_KEY`.

---

## Step 5: Deploy to Railway (Server)

The bot needs to run 24/7 on the internet. Railway is the simplest way to do that.

1. Go to [railway.app](https://railway.app) and create an account
2. Click **New Project** > **Deploy from GitHub**
   - (If the code isn't on GitHub, click **Empty Project** and upload the code manually)
3. Railway will give you a URL like:
   ```
   https://kibbutz-bot-production.up.railway.app
   ```
4. In Railway's project page, click **Variables** and add all the environment variables:

| Variable | Value |
|----------|-------|
| `TWILIO_ACCOUNT_SID` | Your Account SID from Twilio (starts with AC) |
| `TWILIO_AUTH_TOKEN` | Your Auth Token from Twilio |
| `TWILIO_WHATSAPP_NUMBER` | `whatsapp:+14155238886` (the Sandbox number) |
| `GOOGLE_SHEET_ID` | The Sheet ID from Step 1 |
| `GOOGLE_CREDENTIALS_JSON` | The entire contents of `credentials.json` as a string (see below) |
| `COORDINATOR_PHONE` | `whatsapp:+972XXXXXXXXX` (coordinator's number with country code) |
| `PORT` | `3000` |
| `BASE_URL` | The URL you got from Railway |
| `TIMEZONE` | `Asia/Jerusalem` |
| `ADMIN_API_KEY` | The key from Step 4 |

**For Google credentials**, you have two options:
- **Option A (recommended for cloud):** Set `GOOGLE_CREDENTIALS_JSON` to the entire contents of `credentials.json` as a string. Open the file in a text editor, copy everything, and paste it as the value.
- **Option B (local/file):** Upload `credentials.json` to the project and set `GOOGLE_CREDENTIALS_PATH=./credentials.json` instead.

---

## Step 6: Initialize the Sheet

Run this once (from your computer or Railway's terminal):

```bash
npm install
npm run setup-sheets
```

This creates 3 sheets: **Personnel**, **PendingChanges**, **ConversationState** - with headers and sample data.

> **Alternative:** Instead of editing the sheet manually, the coordinator can add people directly from WhatsApp. When the list is empty, the bot guides the coordinator through adding people step by step.

---

## Step 7: Connect Twilio to the Bot

1. Go back to the [Twilio Console](https://console.twilio.com)
2. Navigate to **Messaging** > **Settings** > **WhatsApp Sandbox**
3. Set:
   - **When a message comes in**: `https://YOUR_RAILWAY_URL/webhook`
   - **Status callback URL**: `https://YOUR_RAILWAY_URL/status`
4. Click **Save**

---

## Step 8: Test It

1. Send a WhatsApp message to the Twilio number from the coordinator's phone
2. If the list is empty - the bot will offer to add people
3. If there are people in the list - send a message from a phone that's in the list
4. You should see a menu: 1. I'm leaving, 2. I'm back, 3. View roster
5. Send `1` - the coordinator will receive an approval request
6. Coordinator replies `1` to approve - everyone gets the updated roster

**Verify the admin endpoint:**
```
https://YOUR_RAILWAY_URL/roster?key=YOUR_ADMIN_API_KEY
```

---

## Commands

### For Personnel:
| Message | Action |
|---------|--------|
| `1` / `leaving` / `יוצא` / `יוצאת` | Report leaving the kibbutz |
| `2` / `back` / `חזרתי` / `חזרה` | Report returning to the kibbutz |
| `3` / `roster` / `תורנות` / `רשימה` | View current on-call roster |
| `hi` / `menu` / `תפריט` / `שלום` | Show main menu |

### For Coordinator:
| Message | Action |
|---------|--------|
| `1` / `approve` / `אשר` | Approve roster change |
| `2` / `reject` / `דחה` | Reject change |
| `3` / `change` / `החלף` | Pick a different replacement |
| `add` / `הוסף` | Add a person to the list |
| `remove` / `הסר` | Remove a person from the list |

### Roles (when adding):
| English | Hebrew |
|---------|--------|
| Doctor | רופא / רופאה |
| Nurse | אח / אחות |
| Paramedic | חובש / חובשת |

---

## Costs

| Service | Cost |
|---------|------|
| Twilio WhatsApp messages | ~$0.005/message |
| Railway hosting (free tier) | $0/month |
| Google Sheets | Free |
| **Total for ~200 messages/month** | **~$1-5/month** |

For production (a real WhatsApp Business number), Twilio charges a monthly fee for the number plus per-message costs. Expect ~$15-20/month total.

---

## Troubleshooting

**Bot doesn't respond to messages:**
- Check that the webhook URL is correct in Twilio Console
- Make sure the sender's phone number is in the Personnel list
- Check Railway logs for errors
- Try `DEMO_MODE=true` to test locally without Twilio

**Google Sheets errors:**
- Make sure the service account email has Editor access to the sheet
- Make sure `credentials.json` is in the right place (or `GOOGLE_CREDENTIALS_JSON` is set)
- Verify the Sheet ID is correct

**Coordinator doesn't receive notifications:**
- Check `COORDINATOR_PHONE` - must be in the format `whatsapp:+972XXXXXXXXX`
- The coordinator's number does NOT need to be in the Personnel list

---

## Moving to Production WhatsApp

The Twilio Sandbox is great for testing but has limitations. For real use:

1. Apply for WhatsApp Business API access through Twilio
2. This requires Meta (Facebook) approval - takes 1-7 days
3. You'll get a dedicated WhatsApp number
4. Update your Twilio credentials (or set up a `production` profile — see `.env.example` for details)
5. All personnel just save the number and message it

No app installation needed - it's just a WhatsApp contact.
