# Kibbutz Emergency Bot - Code Review

## Overview

A WhatsApp bot that manages a kibbutz's emergency on-call roster. Personnel report their availability via WhatsApp, a coordinator approves roster changes, and updated rosters are broadcast to all personnel automatically.

**Stack:** Node.js, Express, Twilio (WhatsApp), Google Sheets (database), dotenv, Jest

**Source files:** 5 modules + 4 test files

---

## Architecture

```
Twilio (WhatsApp)
       |
       v
  index.js          Express server, webhook endpoints, auth middleware
       |
       v
   bot.js            Message routing, conversation state, business logic
      / \
     v   v
database.js       whatsapp.js
Google Sheets     Twilio API
read/write        send/validate messages
```

The project follows a clean layered architecture with clear separation of concerns:

| Module | Responsibility |
|--------|---------------|
| `src/index.js` | HTTP server, webhook routing, Twilio signature validation, API key middleware |
| `src/bot.js` | Business logic, deferred approval flow, approval queue |
| `src/database.js` | Google Sheets CRUD, persistent state, fair replacement, roster formatting |
| `src/whatsapp.js` | Twilio message sending, signature validation helper |
| `src/setup-sheets.js` | One-time sheet initialization (Personnel, PendingChanges, ConversationState) |

---

## Strengths

### Clean module separation
Each file has a single responsibility. Dependencies flow downward: `index` -> `bot` -> `database` / `whatsapp`. No circular dependencies.

### Practical technology choices
Google Sheets as a database is appropriate for kibbutz-scale usage (~12 personnel). It provides a familiar UI for the coordinator to view and manually edit data when needed. Twilio handles WhatsApp complexity. Express is minimal and well-suited for webhook handling.

### Good user experience
- Personnel interact with simple numbered menus (1/2/3)
- Natural language aliases work too ("leaving", "back", "roster")
- Privacy: only the coordinator sees who left; everyone else sees the clean roster
- Immediate confirmation to users, async coordinator notification
- Coordinator can also use the bot as regular personnel if they're on the list

### Solid error guards
- Duplicate status checks prevent accidental double-reports
- Unknown phone numbers get a helpful message
- Media messages are ignored gracefully
- `Promise.allSettled()` for broadcast prevents one failed send from blocking others

### Well-documented
- README covers setup end-to-end across Google Cloud, Twilio, Railway
- Code has descriptive headers and inline comments
- `.env.example` is thoroughly annotated

---

## Issues Found and Resolved

### Critical

**1. In-memory conversation state is lost on restart** - FIXED

Conversation state is now persisted to a dedicated `ConversationState` Google Sheet. An in-memory cache provides fast access, and `restoreConversationState()` runs on startup to recover any pending approval flows after a restart. State writes go to both cache and sheet simultaneously.

**2. Status updated before coordinator approval** - FIXED

For on-call personnel, the status change to `out_of_town` is now **deferred** until the coordinator approves. If rejected, no status was ever changed so there's nothing to revert. Non-on-call personnel still get their status updated immediately (no approval needed).

### Moderate

**3. No Twilio webhook signature validation** - FIXED

Added `requireTwilioSignature` middleware to `/webhook` and `/status` endpoints. Uses `twilio.validateRequest()` to verify the `X-Twilio-Signature` header against the auth token and request URL. Gracefully skips validation when `BASE_URL` is not set (local development).

**4. Unprotected admin endpoints** - FIXED

`/roster` and `/personnel` are now protected by `requireApiKey` middleware. Requires `ADMIN_API_KEY` env var to be set. Phone numbers are redacted from both endpoints — `/roster` replaces numbers with `***-****`, and `/personnel` omits the phone field entirely.

**5. Multiple concurrent pending approvals not handled** - FIXED

Implemented an approval queue. When a new on-call person leaves while the coordinator is already reviewing another change, the bot notifies the coordinator that the request is queued. After each approval/rejection, `presentNextPending()` checks for the next pending approval in the PendingChanges sheet and presents it automatically.

**6. Replacement logic is positional, not fair** - FIXED

Added a `LastOnCall` column (F) to the Personnel sheet. `findReplacement()` now sorts available personnel by their `lastOnCall` timestamp ascending — people who were never on-call are picked first, then the least-recently-assigned. `setOnCall()` records the timestamp when someone is assigned.

### Minor

**7. Phone normalization could collide** - FIXED

Replaced the trailing-10-digit fallback with canonical E.164-style normalization. `normalizePhone()` strips the `whatsapp:` prefix, spaces, dashes, and parentheses, then does exact match. Exported the function for use across modules.

**8. Hardcoded timezone** - FIXED

Added `TIMEZONE` environment variable (default: `Asia/Jerusalem`). Used in `formatRoster()` for the "Updated:" timestamp.

**9. `broadcastRoster` double-formats the roster** - FIXED

`broadcastRoster()` now sends the pre-formatted roster string from `formatRoster()` directly, without re-wrapping it with duplicate headers, separators, or timestamps. Also removed the unused `sendWithOptions` function.

**10. No test suite** - FIXED

Added Jest with 68 tests across 4 test files:
- `tests/database.test.js` — phone normalization, personnel lookup, fair replacement, state persistence, roster formatting
- `tests/bot.test.js` — leaving/returning flows, deferred status, coordinator approval/rejection, concurrent approval queue
- `tests/whatsapp.test.js` — message sending, broadcast (no double-wrap), signature validation
- `tests/index.test.js` — Twilio signature middleware, API key protection, phone redaction

---

## Summary

| Area | Rating | Notes |
|------|--------|-------|
| Architecture | Good | Clean separation, appropriate for scope |
| Code quality | Good | Readable, consistent style, well-commented |
| Error handling | Good | Happy path and edge cases covered |
| Security | Good | Webhook validation, API key protection, phone redaction |
| Testing | Good | 68 tests covering all major flows and edge cases |
| Documentation | Good | Thorough README, annotated config |
| Scalability | Adequate | Designed for kibbutz-scale (~12 people) |
| Production readiness | Good | All critical and moderate issues resolved |

The bot is well-built for its intended purpose with clean architecture and thoughtful UX. All 10 identified issues have been resolved.
