# Kibbutz Emergency Personnel Bot

A WhatsApp bot that manages your kibbutz's emergency on-call roster. Personnel report leaving or returning, the coordinator approves roster changes, and everyone gets the updated roster automatically.

All user-facing messages are in Hebrew. Commands accept both Hebrew and English input.

---

## How It Works

```
Person sends          Bot notifies         Coordinator            Everyone gets
"1" or "יוצא"  ->   coordinator     ->   approves/rejects  ->   updated roster
"2" or "חזרתי"       privately            the change             (names only)
```

**Privacy**: Only the coordinator sees who left. Everyone else only sees the updated on-call list.

---

## Quick Start

```bash
cp .env.example .env        # Configure your credentials
npm install                  # Install dependencies
npm run setup-sheets         # Create sheet structure
npm start                    # Start the bot
```

Or try without Twilio first: set `DEMO_MODE=true` in `.env` to log messages to console instead of sending them.

---

## Setup Guide

See [DEPLOY.md](DEPLOY.md) for detailed step-by-step deployment instructions.

---

## Configuration

Copy `.env.example` to `.env` and fill in your values:

| Variable | Required | Description |
|----------|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID (starts with AC) |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio Auth Token |
| `TWILIO_WHATSAPP_NUMBER` | Yes | Bot's WhatsApp number (e.g. `whatsapp:+14155238886`) |
| `GOOGLE_SHEET_ID` | Yes | Google Sheet ID from the URL |
| `GOOGLE_CREDENTIALS_PATH` | Yes* | Path to `credentials.json` file |
| `GOOGLE_CREDENTIALS_JSON` | Yes* | OR paste the JSON string directly (for cloud deploys) |
| `COORDINATOR_PHONE` | Yes | Coordinator's WhatsApp (e.g. `whatsapp:+972501234567`) |
| `PORT` | No | Server port (default: 3000) |
| `BASE_URL` | No | Public URL for webhooks. Enables Twilio signature validation |
| `TIMEZONE` | No | Timezone for timestamps (default: `Asia/Jerusalem`) |
| `ADMIN_API_KEY` | No | Protects `/roster` and `/personnel` admin endpoints |
| `DEMO_MODE` | No | Set to `true` to log messages instead of sending via Twilio |
| `TWILIO_PROFILE` | No | Named Twilio profile (e.g. `sandbox` or `production`) |

*One of `GOOGLE_CREDENTIALS_PATH` or `GOOGLE_CREDENTIALS_JSON` is required. If both are set, `GOOGLE_CREDENTIALS_JSON` takes priority.

### Twilio Profiles

Instead of swapping credentials manually, you can define named profiles:

```env
TWILIO_PROFILE=sandbox

TWILIO_SANDBOX_ACCOUNT_SID=ACxxxxxxxx
TWILIO_SANDBOX_AUTH_TOKEN=token_here
TWILIO_SANDBOX_WHATSAPP_NUMBER=whatsapp:+14155238886

TWILIO_PRODUCTION_ACCOUNT_SID=ACyyyyyyyy
TWILIO_PRODUCTION_AUTH_TOKEN=token_here
TWILIO_PRODUCTION_WHATSAPP_NUMBER=whatsapp:+972...
```

Switch environments by changing one variable: `TWILIO_PROFILE=production`.

---

## Google Sheet Structure

The setup script (`npm run setup-sheets`) creates these automatically:

**Personnel** sheet:
| Name | Role | Phone | Status | OnCall | LastOnCall |
|------|------|-------|--------|--------|------------|
| Dr. Sarah Cohen | Doctor | +972-50-111-1111 | on_call | TRUE | |

- **Role**: `Doctor`, `Nurse`, or `Paramedic`
- **Status**: `on_call`, `available`, or `out_of_town`
- **OnCall**: `TRUE` or `FALSE`
- **LastOnCall**: Timestamp of last on-call assignment (used for fair rotation)

**PendingChanges** sheet (managed by the bot):
| ID | PersonName | PersonPhone | ReplacementName | ReplacementPhone | Timestamp | Status | Type |

**ConversationState** sheet (managed by the bot):
| Phone | Step | Data | UpdatedAt |

Conversation state is persisted so pending approvals survive server restarts.

---

## Commands Reference

### For Personnel:
| Message | Action |
|---------|--------|
| `1` / `leaving` / `יוצא` / `יוצאת` | Report leaving the kibbutz |
| `2` / `back` / `חזרתי` / `חזרה` | Report returning to the kibbutz |
| `3` / `roster` / `תורנות` | View current on-call roster |
| `hi` / `menu` / `תפריט` / `שלום` | Show the main menu |

### For Coordinator (approval requests):
| Message | Action |
|---------|--------|
| `1` / `approve` / `אשר` | Approve the roster change |
| `2` / `reject` / `דחה` | Reject the change |
| `3` / `change` / `החלף` | Pick a different replacement |

### For Coordinator (personnel management):
| Message | Action |
|---------|--------|
| `add` / `הוסף` | Add a person (prompts for name, role, phone) |
| `remove` / `הסר` | Remove a person (shows numbered list) |

When the personnel list is empty, the bot automatically guides the coordinator through adding people.

### Roles (when adding personnel):
| English | Hebrew |
|---------|--------|
| Doctor | רופא / רופאה |
| Nurse | אח / אחות |
| Paramedic | חובש / חובשת |

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | None | Health check |
| POST | `/webhook` | Twilio signature | Incoming WhatsApp messages |
| POST | `/status` | Twilio signature | Message delivery status |
| GET | `/roster` | API key | View roster (phone numbers redacted) |
| GET | `/personnel` | API key | View personnel list (phone numbers omitted) |

Admin endpoints require `?key=YOUR_ADMIN_API_KEY` or `x-api-key` header.

---

## Costs

| Service | Cost |
|---------|------|
| Twilio WhatsApp messages | ~$0.005/message |
| Railway hosting (free tier) | $0/month |
| Google Sheets | Free |
| **Total for ~200 messages/month** | **~$1-5/month** |

For production (real WhatsApp Business number), expect ~$15-20/month total.

---

## Testing

```bash
npm test
```

Runs 88 tests covering bot flows, database operations, API endpoints, and WhatsApp messaging.

---

## Troubleshooting

**Bot doesn't respond to messages:**
- Check that the webhook URL is correct in Twilio Console
- Make sure the sender's phone number is in the Personnel list
- Check Railway logs for errors
- Try `DEMO_MODE=true` to test locally without Twilio

**Google Sheets errors:**
- Make sure the service account email has Editor access to the sheet
- Check that `credentials.json` is in the right place (or `GOOGLE_CREDENTIALS_JSON` is set)
- Verify the Sheet ID is correct

**Coordinator doesn't receive notifications:**
- Check `COORDINATOR_PHONE` — must be in format `whatsapp:+972XXXXXXXXX`
- The coordinator's number does NOT need to be in the Personnel list

---

## Moving to Production WhatsApp

The Twilio Sandbox is great for testing but has limitations. For real use:

1. Apply for WhatsApp Business API access through Twilio
2. This requires Meta (Facebook) approval — takes 1-7 days
3. You'll get a dedicated WhatsApp number
4. Update your Twilio credentials (or create a `production` profile)
5. All personnel just save the number and message it

No app installation needed — it's just a WhatsApp contact.
