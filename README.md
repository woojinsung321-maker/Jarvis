# JARVIS - Phase 1: Foundation

A mobile-first, installable (PWA) chat app with a dark, electric-blue interface.
Plain HTML, CSS and JavaScript. No build step, no accounts, no paid services. No secrets anywhere in these files.

**What Phase 1 does:** chat screen, install-to-home-screen, works offline (the screen, not an AI).
**What it does not do yet:** there is no AI. Replies are a local echo and the header says LOCAL MODE.
Login and the Gemini connection come in Phase 2. Chats are not saved yet (Phase 3).

## Files (all in one folder on purpose)

Phone file pickers cannot select folders, so every file sits at the top level. Upload them all together.

| File | Purpose |
|---|---|
| index.html | The page |
| styles.css, theme.css | Look and layout (colors live in theme.css) |
| app.js | Starts the app, wires everything together |
| chat-ui.js | Draws messages on screen |
| backend.js | The only file that talks to a backend (local echo for now) |
| config.js | Settings (backend address goes here later; it is not a secret) |
| pwa.js | Service worker registration and the Install button |
| sw.js | Service worker (offline support) |
| manifest.json | Makes the app installable |
| _headers | Security headers for Cloudflare Pages |
| icon-192.png, icon-512.png | App icons |

## 1. Upload to GitHub (Android Chrome)

1. Download `jarvis-phase-1.zip`. In the Files app, tap it and choose **Extract**.
2. In Chrome open github.com, sign in, open your `jarvis` repository.
   Tip: Chrome menu (three dots) > **Desktop site** makes the buttons easier to find.
3. If you earlier added files from a previous version, delete them first (open the file, trash icon, commit).
4. Tap **Add file > Upload files > choose your files**.
5. Open the extracted `jarvis` folder and select **all 14 files** (including README.md and `_headers`).
   If the picker hides a file, tap the menu and turn on "Show all files" or search for it by name.
6. Wait for all uploads to finish, then tap **Commit changes**.
7. Check the repository front page: you should see all 14 files at the top level, not inside a folder.

## 2. Publish with Cloudflare Pages (free)

1. Cloudflare dashboard > **Workers & Pages > Create > Pages > Connect to Git** > choose `jarvis`.
2. Framework preset: **None**. Build command: leave **empty**. Build output directory: leave **empty** (or type `/`).
3. **Save and Deploy**, then open the `*.pages.dev` address it gives you.

Later updates: edit or upload files on GitHub and commit. Cloudflare redeploys by itself. Reload the page to see changes.

## 3. Install on your phone

Open the `*.pages.dev` address in Chrome. Tap **Install** in the app header (or Chrome menu > **Install app**).
It then opens full-screen from your home screen.

## 4. Test checklist

1. The page loads with a glowing blue header and LOCAL MODE.
2. Type a message, tap the arrow: your message appears on the right, an echo on the left.
3. **New chat** clears the conversation.
4. Install works and the app opens full-screen.
5. Airplane mode: open the installed app. It still opens and the echo chat still works.
6. The on-screen keyboard does not cover the input box.

If something fails, note exactly what you saw and tell Claude.

## Safety notes

- Never put passwords or API keys in any of these files. Real secrets will live only in Cloudflare secrets (Phase 2).
- The repository will be public (free Cloudflare Pages from GitHub is simplest that way). Keep it free of private data.
- `_headers` currently only allows the app to talk to itself. When a backend address is added in Phase 2, that file gets updated too.

## Tested

Automatically, in headless Chrome with Pixel 7 emulation (layout, chat, offline start, service worker, install checks).
Not yet tested on a real phone or on a real Cloudflare deployment: that is what the checklist above is for.
