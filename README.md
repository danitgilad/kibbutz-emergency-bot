# 🚑 Kibbutz Emergency Personnel Bot

A WhatsApp bot that manages your kibbutz's emergency on-call roster. Personnel tap a button to report leaving or returning, the coordinator approves changes, and everyone gets the updated roster automatically.

---

## How It Works

```
Person taps           Bot updates         Coordinator gets        Everyone gets
"I'm Leaving"  →     their status    →   private approval    →   clean roster
or "I'm Back"        instantly            request                 (names only)
```

**Privacy**: Only the coordinator sees who left. Everyone else only sees the updated on-call list.

---

## Setup Guide (Step by Step)

### Step 1: Get the Code

Download this entire folder to your computer.

### Step 2: Create a Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet
2. Name it "Kibbutz Emergency Roster"
3. Copy the **Sheet ID** from the URL — it's the long string between `/d/` and `/edit`:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
   ```
4. Save this ID — you'll need it later

### Step 3: Set Up Google Service Account

This lets the bot read/write your Google Sheet.

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (name it anything, e.g., "kibbutz-bot")
3. Enable the **Google Sheets API**:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"
4. Create a Service Account:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Name it "kibbutz-bot" and click through the steps
5. Create a key for the service account:
   - Click on the service account you just created
   - Go to "Keys" tab
   - Click "Add Key" > "Create new key" > JSON
   - A file will download — rename it to `credentials.json`
   - Put this file in the project folder
6. Share your Google Sheet with the service account:
   - Copy the service account email (looks like: `kibbutz-bot@project-name.iam.gserviceaccount.com`)
   - Open your Google Sheet
   - Click "Share" and paste that email, give it "Editor" access

### Step 4: Set Up Twilio

1. Go to [twilio.com](https://www.twilio.com) and create a free account
2. Once logged in, go to the [Twilio Console](https://console.twilio.com)
3. Note your **Account SID** and **Auth Token** (shown on the dashboard)
4. Set up WhatsApp Sandbox (for testing):
   - Go to Messaging > Try it out > Send a WhatsApp message
   - Follow the instructions to connect your phone to the sandbox
   - Note the sandbox number (e.g., `+1 415 523 8886`)
5. Later, for production, you'll apply for a real WhatsApp Business number through Twilio

### Step 5: Configure the Bot

1. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
2. Edit `.env` with your actual values:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxx     (from Twilio Console)
   TWILIO_AUTH_TOKEN=your_token_here         (from Twilio Console)
   TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886  (your Twilio WhatsApp number)

   GOOGLE_SHEET_ID=your_sheet_id_here        (from Step 2)
   GOOGLE_CREDENTIALS_PATH=./credentials.json

   COORDINATOR_PHONE=whatsapp:+972501234567  (coordinator's WhatsApp number)

   PORT=3000
   BASE_URL=https://your-deployed-url.com    (fill in after Step 7)
   ```

### Step 6: Install and Set Up

Open a terminal in the project folder and run:

```bash
npm install
npm run setup-sheets
```

This installs dependencies and creates the sheet structure with sample data. Then edit the Google Sheet with your real personnel names and phone numbers.

### Step 7: Deploy (Put It Online)

The bot needs to run 24/7 on the internet. Here's the easiest way using Railway:

1. Go to [railway.app](https://railway.app) and sign up (free tier available)
2. Click "New Project" > "Deploy from GitHub" (or "Empty Project" > upload code)
3. Add your environment variables in Railway's dashboard (same values as your `.env` file)
4. Upload `credentials.json` or paste its contents as an environment variable
5. Railway will give you a URL like `https://kibbutz-bot-production.up.railway.app`
6. Update `BASE_URL` in Railway's environment variables with this URL

### Step 8: Connect Twilio to Your Bot

1. Go to [Twilio Console](https://console.twilio.com) > Messaging > Settings
2. Under WhatsApp Sandbox (or your WhatsApp number), set:
   - **When a message comes in**: `https://YOUR_RAILWAY_URL/webhook` (POST)
   - **Status callback URL**: `https://YOUR_RAILWAY_URL/status` (POST)
3. Save

### Step 9: Test It!

1. Send a WhatsApp message to your Twilio number from a phone number that's in the Personnel sheet
2. You should get the main menu: 1. I'm Leaving, 2. I'm Back, 3. View Roster
3. Try sending "1" — you should get a confirmation, and the coordinator should get an approval request
4. Have the coordinator reply "1" to approve — everyone should get the updated roster

---

## Google Sheet Structure

The setup script creates this automatically:

**Personnel** sheet:
| Name | Role | Phone | Status | OnCall |
|------|------|-------|--------|--------|
| Dr. Sarah Cohen | Doctor | +972-50-111-1111 | on_call | TRUE |
| Nurse Miriam Shapiro | Nurse | +972-50-222-1111 | available | FALSE |

- **Role**: Must be exactly `Doctor`, `Nurse`, or `Paramedic`
- **Status**: `on_call`, `available`, or `out_of_town`
- **OnCall**: `TRUE` or `FALSE` — should always have 2 per role set to TRUE

**PendingChanges** sheet (managed by the bot automatically):
| ID | PersonName | PersonPhone | ReplacementName | ReplacementPhone | Timestamp | Status | Type |

---

## Commands Reference

### For Personnel:
| Send | Action |
|------|--------|
| `1` or `leaving` | Report leaving the kibbutz |
| `2` or `back` | Report returning to the kibbutz |
| `3` or `roster` | View current on-call roster |
| `hi` or `menu` | Show the main menu |

### For Coordinator (when receiving an approval request):
| Send | Action |
|------|--------|
| `1` or `approve` | Approve the roster change |
| `2` or `reject` | Reject the change |
| `3` or `change` | Pick a different replacement |

---

## Costs

| Service | Cost |
|---------|------|
| Twilio WhatsApp messages | ~$0.005/message |
| Railway hosting (free tier) | $0/month |
| Google Sheets | Free |
| **Total for ~200 messages/month** | **~$1-5/month** |

For production (real WhatsApp Business number), Twilio charges a monthly fee for the number plus per-message costs. Expect ~$15-20/month total.

---

## Troubleshooting

**Bot doesn't respond to messages:**
- Check that the webhook URL is correct in Twilio Console
- Make sure the sender's phone number is in the Personnel sheet
- Check Railway logs for errors

**Google Sheets errors:**
- Make sure the service account email has Editor access to the sheet
- Check that `credentials.json` is in the right place
- Verify the Sheet ID is correct

**Coordinator doesn't receive notifications:**
- Check `COORDINATOR_PHONE` in `.env` — must be in format `whatsapp:+XXXXXXXXXXXX`
- The coordinator's number does NOT need to be in the Personnel sheet

---

## Moving to Production WhatsApp

The Twilio Sandbox is great for testing but has limitations. For real use:

1. Apply for WhatsApp Business API access through Twilio
2. This requires Meta (Facebook) approval — takes 1-7 days
3. You'll get a dedicated WhatsApp number
4. Your personnel just save this number and start messaging

No app installation needed — it's just a WhatsApp contact.
