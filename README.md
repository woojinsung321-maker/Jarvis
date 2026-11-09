# JARVIS - Phase 2: AI Brain

Phase 1 (the app) plus a secure backend: owner-only login, Gemini replies, request checks and rate limits.
Everything is free. **No secret is stored in any file of this project.**

## How it fits together

The backend is `_worker.js`: a Cloudflare Worker that runs inside your Cloudflare Pages site ("advanced mode").
It lives on the same web address as the app, so the login cookie stays private and no cross-site tricks are needed.
`_routes.json` sends only `/api/*` requests to it; the app files are served directly by Cloudflare.

- `POST /api/login` passphrase -> signed, HttpOnly, Secure, SameSite=Strict cookie (7 days)
- `POST /api/chat` needs that cookie, checks the request, asks Gemini, returns the reply
- `POST /api/logout`, `GET /api/session`, `GET /api/models` (shows which Gemini models your key can use)

## Where the secrets live (never in GitHub)

You type them into the Cloudflare dashboard. Cloudflare stores them encrypted and gives them only to the Worker.

| Secret name | What to enter |
|---|---|
| `OWNER_PASSPHRASE` | Your login passphrase. At least 16 characters. Four or five random words work well. |
| `SESSION_SECRET` | Random text, at least 32 characters (mash the keyboard or use a password manager). Changing it logs out every device. |
| `GEMINI_API_KEY` | Your key from aistudio.google.com |

Optional plain variable (not secret): `GEMINI_MODELS` = comma-separated model names, tried in order.
Default is `gemini-flash-lite-latest,gemini-flash-latest`.

## Deploy from your Android phone

Do the steps in this order so the first deployment already has its secrets.

1. **Get a Gemini key.** Chrome > aistudio.google.com > sign in > **Get API key** > create a key. Do not add billing.
2. **Add the secrets.** Cloudflare dashboard > Workers & Pages > your `jarvis` Pages project >
   **Settings > Variables and Secrets** (use Chrome's **Desktop site** if the page looks cramped).
   Add the three secrets above for the **Production** environment, choosing the type **Secret** (encrypted) for each.
3. **Upload to GitHub.** Extract `jarvis-phase-2.zip` in the Files app. In your `jarvis` repo tap
   **Add file > Upload files** and select **all 18 files** from the extracted folder.
   Files with the same names replace the old ones. Commit with a message like "Phase 2 backend".
4. **Wait for the deploy.** Cloudflare redeploys automatically after the commit (the Deployments tab shows progress).
   If you add or change secrets later, the change only applies to the NEXT deployment: open the latest deployment
   and use **Retry deployment**, or commit any small change.
5. **Open the app** and reload it once so the new version replaces the old one. You should see the login screen.

If the app opens straight into chat with the old LOCAL MODE label, the old version is still cached:
close the app completely and reopen it, or clear the site data for your `pages.dev` address in Chrome.

## Test checklist

1. Login screen appears (no chat visible before signing in).
2. A wrong passphrase shows "Wrong passphrase."
3. The right passphrase opens the chat; the header says SECURE LINK.
4. Send "Say hello in one sentence": a Gemini reply appears.
5. Close and reopen the app: still signed in. **Lock** returns to the login screen.
6. Open `your-address/api/models` in Chrome while signed in: it lists model names. Signed out it shows `unauthorized`.
7. Airplane mode: the installed app still opens (status OFFLINE); sending shows a connection error.

## If something goes wrong

| What you see | Meaning and fix |
|---|---|
| "Server setup incomplete: ..." | That secret is missing or too short. Add it (step 2), then retry the deployment. |
| "The Gemini key is not set" | `GEMINI_API_KEY` is missing in Production. Add it, then retry the deployment. |
| "No configured Gemini model was found" | Open `/api/models`, pick names from the list, set `GEMINI_MODELS`, retry the deployment. |
| "The free Gemini limit was reached" | Free-tier quota used up. Wait, or list more models in `GEMINI_MODELS`. |
| "Gemini rejected the request" | The API key is wrong or disabled. Create a new key and replace the secret. |
| "Too many attempts" | 5 wrong passphrases from one address. Wait about 15 minutes. |
| Blank page or no login after upload | Make sure `_worker.js` and `_routes.json` are in the top level of the repo, not in a folder. |

## Security notes

- The passphrase is compared as hashes; the cookie is signed with `SESSION_SECRET` and cannot be read by page scripts.
- State-changing requests must come from your own site (origin check), carry JSON, and stay under 64 KB.
- Rate limits: 5 login attempts per 15 minutes per address, 20 chat messages per minute per login.
  They are kept in the Worker's memory, so they are best-effort (a restart resets them). The 16+ character passphrase is the real protection.
  Durable limits can come with Phase 3 storage.
- Logging out clears the cookie on this device. To end every session everywhere, change `SESSION_SECRET` and retry the deployment.
- Free Gemini tier: Google may use your prompts to improve its products. Do not send passwords or private identity data.
- The repository is public. `_worker.js` contains no secrets, so that is safe, but never commit keys, passwords or `.dev.vars` files.
- The Worker returns only short error codes. Details stay in Cloudflare's logs and never include your messages or keys.

## Files

| File | Purpose |
|---|---|
| `_worker.js` | NEW. The backend (login, sessions, rate limits, Gemini) |
| `_routes.json` | NEW. Sends only `/api/*` to the Worker |
| `auth.js`, `login.css` | NEW. Login screen code and styling |
| `index.html`, `app.js`, `backend.js`, `config.js`, `sw.js` | UPDATED for login and the backend |
| `styles.css`, `theme.css`, `chat-ui.js`, `pwa.js`, `manifest.json`, `_headers`, icons | Unchanged from Phase 1 |

Phase 1 local demo mode still exists: set `USE_BACKEND: false` in `config.js` to turn the backend off.

## Tested

Automatically, with a copy of the real Worker code and a fake Gemini: 22 groups of Worker tests (login, cookies, forged and
expired cookies, validation, rate limits, model fallback, error handling, no secret in any response) and a full set of
phone-sized Chrome checks (login flow, chat, lock, offline start, caching, install checks).
**Not yet tested:** your real Cloudflare deployment, the real Gemini API with your key, and the real phone.
The checklist above is how you confirm those.
JARVIS Phase 2 deployment update
