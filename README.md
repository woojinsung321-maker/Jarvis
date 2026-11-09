# JARVIS - Phase 3: Persistent memory and conversation history

Phase 1 (the app) + Phase 2 (owner login, Gemini) + **Phase 3: every conversation is saved, and JARVIS keeps
long-term memories that carry over between chats.** Everything stays on the free tier (Cloudflare Pages + D1 + Gemini free).
**No secret is stored in any file of this project.**

## What is new in Phase 3

- **Chat history** (menu button, top left): every conversation is saved in D1 with timestamps, sorted by latest activity.
  Reopen, rename or delete any of them (deleting asks for confirmation).
- **Long-term memory** (brain button, top right): six categories (preference, fact, project, goal, instruction, decision).
  View, search, filter, add, edit, delete, and clear all (after confirmation). Created and updated dates are shown.
- **Saving memories**
  - Start a message with **"Remember that ..."** (also "Don't forget ...", "Keep in mind ...") and it is saved. A card under the reply confirms it, with **Undo**.
  - Statements like "I'm currently developing ...", "My project must ...", "I prefer ..." are only **proposed**: a card asks "Remember this?" and nothing is saved until you tap Save.
  - Passwords, API keys, tokens and card numbers are **never** saved (refused with a message).
  - A memory identical to an existing one is not saved twice. A *similar* one is never saved or overwritten silently: you choose **Replace old**, **Keep both** or **Dismiss**.
  - Editing a memory is always your own action in the Memory screen.
- **Smart retrieval**: before each answer the Worker picks only the few memories that match the words of your message
  (keywords + category + scoring), at most 6 and about 1,500 characters. Style preferences ("short answers") apply to every answer.
  The whole memory table is never sent to Gemini. A note under the reply shows which memories were used.
- **Safe prompting**: memories reach Gemini inside a `<saved_notes>` block marked as background information, not commands.
- Header buttons are now icons so everything fits a phone. The **Install app** button moved into the history drawer.

## Deploy Phase 3 (Android phone, about 10 minutes)

Do these in order. Your existing secrets and Pages project stay as they are.

**1. Create the database and its tables**
1. Cloudflare dashboard > **Storage & databases > D1 SQL database** (older dashboards: Workers & Pages > D1) > **Create database**. Name it `jarvis-db`. Free plan is fine.
2. Open the new database > **Console** tab.
3. Open `migrations/0001_phase3_memory.sql` from this zip (Files app, text viewer), copy **all** of it, paste it into the console and run it.
   It is safe to run twice. If the console complains about running several statements at once, run the statements one at a time.
4. Check: run `SELECT name FROM sqlite_master WHERE type='table';` - you should see `conversations`, `messages`, `memories`.

**2. Bind the database to the Pages project**
1. Workers & Pages > your `jarvis` Pages project > **Settings > Bindings** (older dashboards: **Functions > D1 database bindings**).
2. **Add > D1 database**. Variable name must be exactly **`DB`**. Pick `jarvis-db`. Add it for **Production** (and Preview if you use it).

**3. Upload the new files to GitHub**
1. Extract `jarvis-phase-3.zip` in the Files app. The site is the `jarvis` folder; the `tests` folder is **not** part of the site.
2. In your repo: **Add file > Upload files** and select **all 22 files** inside `jarvis` (not the `migrations` folder - you do not need it in GitHub because you pasted the SQL in step 1).
   Same-named files are replaced. 4 files are new: `dialogs.js`, `history-ui.js`, `memory-ui.js`, `panels.css`.
3. Commit ("Phase 3 memory"). Cloudflare redeploys by itself. Bindings only apply to the **next** deployment, so if the deploy already ran before you added the binding, open the latest deployment and **Retry deployment**.

**4. Open the app and reload once**. The new service-worker cache (`jarvis-shell-v3`) replaces the old files. If you still see the old header with text buttons, close the app completely and reopen it, or clear the site data for your `pages.dev` address.

**Optional (command line users):** `npx wrangler d1 create jarvis-db`, then
`npx wrangler d1 execute jarvis-db --remote --file=migrations/0001_phase3_memory.sql`. The binding is still added in the dashboard as above.

## Where the secrets live (never in GitHub)

You type them into the Cloudflare dashboard. Cloudflare stores them encrypted and gives them only to the Worker.

| Secret name | What to enter |
|---|---|
| `OWNER_PASSPHRASE` | Your login passphrase. At least 16 characters. Four or five random words work well. |
| `SESSION_SECRET` | Random text, at least 32 characters (mash the keyboard or use a password manager). Changing it logs out every device. |
| `GEMINI_API_KEY` | Your key from aistudio.google.com |

Optional plain variable (not secret): `GEMINI_MODELS` = comma-separated model names, tried in order.
Default is `gemini-flash-lite-latest,gemini-flash-latest`.

Phase 3 needs **no new secrets and no new paid service**.

## Verify Phase 3 on your phone (5 minutes)

1. Sign in. Open `/api/diagnostics` in the same browser: the report must contain `"database": {"status": "ok", ...}`. If it says `not_bound` or `not_migrated`, follow its hint.
2. Send "Say hello in one sentence". Tap the menu button: the conversation is listed.
3. Close the app completely, reopen it, tap the menu button, open the conversation: both messages are back.
4. Send "Remember that I prefer short answers." A green "Memory saved" card appears. Open the brain screen: the memory is listed with dates.
5. Tap **New chat**, ask "What is the capital of Peru?": the reply should be short and a note says it used 1 memory.
6. In the brain screen: edit the memory, then delete it (confirm). Ask again: no memory is used any more.
7. Try "Remember that my password is abc123": it must be refused.
8. Rename a conversation, delete one (confirm), try **Clear all memories** and press Cancel.
9. Tap the lock button: the login screen shows and no chat text is left on the page.

## Verify that Gemini really works (the proof step)

Sign in to JARVIS first. Then, in the same Chrome, open:

`https://YOUR-ADDRESS.pages.dev/api/diagnostics`

(Tick "Pretty-print" if Chrome offers it.) The report is JSON. Look at these lines:

| Line | What it proves |
|---|---|
| `"verdict": "gemini_working"` and `"ok": true` | Google answered a real request from your Worker |
| `config.GEMINI_API_KEY: "set"` | The Worker can see your secret (the key itself is never shown) |
| `config.geminiKeyFormat: "looks_like_a_google_key"` | The pasted value has the right shape |
| `tests[0].replyPreview: "OK"` | Gemini's actual reply to the test prompt |
| `tests[0].modelVersion` | The model name Google reports it used |
| `tests[0].tokens` | Token counts Google reports for that call |
| `database.status: "ok"` | (Phase 3) the D1 database is bound and the three tables exist |
| `tests[0].httpStatus: 200` | Google's HTTP answer |

Any other verdict comes with a `hint` that says what to fix. Add `?all=1` to test every configured model.
Each run uses a little free quota, so it is limited to 3 runs per 5 minutes. The report never contains your key, passphrase or session secret.

## API (all need the login cookie; changes also need a same-site request)

| Route | What it does |
|---|---|
| `POST /api/chat` `{conversationId?, message}` | Answers with memory + history, saves both messages, returns memory feedback. The Phase 2 form `{messages}` still works and stores nothing. |
| `GET/POST /api/conversations` | List (latest 100) / create |
| `GET/PATCH/DELETE /api/conversations/:id` | Open with messages / rename / delete with messages |
| `POST /api/conversations/:id/messages` | Save one message by hand |
| `GET/POST/DELETE /api/memories` | List + search (`?q=`, `?category=`) / create (duplicates refused, similar ones need `force`) / clear all (needs `{"confirm":"DELETE_ALL_MEMORIES"}`) |
| `PATCH/DELETE /api/memories/:id` | Edit / delete one |
| `GET /api/memories/search?q=` | The same relevance search Gemini gets |

Limits: message 8,000 characters, memory 500, title 80, request body 64 KB, 2,000 messages per conversation,
1,000 conversations, 500 memories, 60 saves/edits/deletes per minute per login, 20 chat messages per minute.

## If something goes wrong

| What you see | Meaning and fix |
|---|---|
| "Server setup incomplete: ..." | That secret is missing or too short. Add it (step 2), then retry the deployment. |
| "The Gemini key is not set" | `GEMINI_API_KEY` is missing in Production. Add it, then retry the deployment. |
| "No configured Gemini model was found" | Open `/api/models`, pick names from the list, set `GEMINI_MODELS`, retry the deployment. |
| "The free Gemini limit was reached" | Free-tier quota used up. Wait, or list more models in `GEMINI_MODELS`. |
| "Gemini rejected the request" | The API key is wrong or disabled. Create a new key and replace the secret. |
| "Too many attempts" | 5 wrong passphrases from one address. Wait about 15 minutes. |
| `verdict` is `key_missing` | The Worker cannot see `GEMINI_API_KEY`. Add it as a Production secret, then retry the deployment. |
| `database_not_configured` / "The database is not connected" | The D1 binding named `DB` is missing. Do Phase 3 steps 2-3, then retry the deployment. Chat keeps working like Phase 2 meanwhile, but nothing is saved. |
| `database_not_migrated` / "tables are missing" | The database is bound but empty. Do Phase 3 step 1 (run the SQL). |
| Blank page or no login after upload | Make sure `_worker.js` and `_routes.json` are in the top level of the repo, not in a folder. |

## Security notes

- Every route checks the signed owner cookie first (401 otherwise). Changes also check that the request comes from your own site and carries JSON under 64 KB.
- All SQL uses bound parameters; user text is never joined into SQL. Text is drawn on screen with `textContent` only.
- The passphrase is compared as hashes; the cookie is signed with `SESSION_SECRET` and cannot be read by page scripts.
- This is a single-owner app: there are no user accounts, so "belongs to the owner" means "needs the owner's session".
- Rate limits live in the Worker's memory, so they are best-effort (a restart resets them). The 16+ character passphrase is the real protection.
- Logging out clears the cookie on this device. To end every session everywhere, change `SESSION_SECRET` and retry the deployment.
- **Free Gemini tier: Google may use prompts to improve its products.** Your message, recent chat and the selected memories are sent to Google on every question. Do not store private identity data as memories.
- The repository is public. `_worker.js` contains no secrets, but never commit keys, passwords or `.dev.vars` files. Your database content is **not** in the repo.
- The Worker returns only short error codes. Logs contain error names only, never your messages, memories or keys.

## Known limitations

- **Not yet tested on your real setup:** real Cloudflare D1, real Gemini with your key, Cloudflare's deployment of this repo, and a real Android phone. The tests below use a SQLite stand-in for D1 and a fake Gemini. The dashboard menu names above may differ slightly from what you see.
- Retrieval matches **words**, not meaning: a memory about "Godot" will not be found by a question that only says "game engine". Edit memory wording or add keywords naturally to the text.
- Memory proposals and "Remember that ..." detection understand **English** phrasing only, and only the patterns listed above.
- The secret filter is deliberately cautious: it also refuses harmless sentences that contain words like "password" or "token", and long digit strings.
- A turn is saved only after Gemini answers. If Gemini fails, nothing from that turn is saved (your text is put back in the box).
- Conversation titles are the first words of the first message. The list shows the latest 100; opening shows up to 2,000 messages; there is no search across conversation text yet.
- Two devices do not update each other live; each list refreshes when you open it.
- Deleting a conversation or a memory is permanent. There is no trash.
- The Android back button does not close the drawer or memory screen; use the X.

## Files

| File | Purpose |
|---|---|
| `_worker.js` | The backend: login, sessions, Gemini, **conversations, memory, retrieval** |
| `migrations/0001_phase3_memory.sql` | The three D1 tables, indexes and foreign key (run once, see step 1) |
| `app.js` | Wires the screens to the backend |
| `backend.js` | The only file that talks to the backend (now also history + memory calls) |
| `history-ui.js`, `memory-ui.js`, `dialogs.js`, `panels.css` | **New:** history drawer, memory manager, confirm/rename dialogs and toasts, their styling |
| `chat-ui.js`, `index.html`, `sw.js` | Changed: memory note cards, new screens, cache v3 |
| `auth.js`, `login.css`, `config.js`, `pwa.js`, `styles.css`, `theme.css`, `manifest.json`, `_headers`, `_routes.json`, icons | Unchanged from Phase 2 |

Phase 1 local demo mode still exists: set `USE_BACKEND: false` in `config.js` (history and memory are hidden in that mode).

## Tests (in the `tests` folder of the zip, not part of the site)

Last run before packaging: **122 of 122 Worker/API checks and 71 of 71 phone-sized Chromium checks passed.**

- `node --no-warnings tests/run.mjs` (Node 22+): runs the real `_worker.js` against a SQLite stand-in for D1 and a fake Gemini.
- `node --no-warnings tests/e2e.mjs`: drives the real frontend files in phone-sized Chromium against the same Worker. It expects Playwright at `/opt/npm-tools` (the sandbox used to build this), so it will need a path change elsewhere.
