// Entry point: connects the screens (chat-ui, auth), the backend adapter and the PWA helpers.

import { CONFIG } from "./config.js";
import { getMode, getSession, login, logout, sendMessage } from "./backend.js";
import { createChatUI } from "./chat-ui.js";
import { createAuthUI } from "./auth.js";
import { registerServiceWorker, setupInstallButton } from "./pwa.js";

const $ = (id) => document.getElementById(id);
const input = $("input");
const messagesEl = $("messages");

const ui = createChatUI({ messages: messagesEl, input, send: $("send") });
const authUI = createAuthUI({ input: $("passphrase"), button: $("login-button"), error: $("login-error") });
const views = { login: $("login"), app: $("app") };

let history = []; // [{ role: "user" | "assistant", content }] — kept in memory only
let busy = false;

function waitText(seconds) {
  return seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${Math.max(1, seconds)} seconds`;
}

function errorText(err) {
  switch (err.message) {
    case "network_error": return "Cannot reach the server. Check your connection.";
    case "unauthorized": return "Your session ended. Please sign in again.";
    case "too_many_requests": return `Too many messages too fast. Try again in ${waitText(err.retryAfter)}.`;
    case "rate_limited": return "The free Gemini limit was reached. Wait a bit and try again.";
    case "model_not_found": return "No configured Gemini model was found. See README (GEMINI_MODELS).";
    case "provider_not_configured": return "The Gemini key is not set on the server. See README.";
    case "provider_rejected_request": return "Gemini rejected the request. Check the API key.";
    case "blocked_by_provider": return "Gemini declined to answer that.";
    case "empty_reply": return "Gemini returned an empty reply. Try rephrasing.";
    case "provider_unavailable":
    case "provider_error": return "Gemini is not responding right now. Try again shortly.";
    case "payload_too_large": return "That message is too long.";
    case "forbidden": return "The request was blocked. Reload the app and try again.";
    case "bad_response": return "The server sent an unexpected reply.";
    default: return `Something went wrong (${err.message}).`;
  }
}

function loginErrorText(err) {
  switch (err.message) {
    case "invalid_credentials": return "Wrong passphrase.";
    case "too_many_attempts": return `Too many attempts. Try again in ${waitText(err.retryAfter)}.`;
    case "server_not_configured":
      return `Server setup incomplete${err.missing?.length ? `: ${err.missing.join(", ")}` : ""}. See README.`;
    default: return errorText(err);
  }
}

function showView(name) {
  views.login.hidden = name !== "login";
  views.app.hidden = name !== "app";
  if (name === "login") authUI.focus();
}

function setStatus(text) {
  $("status-text").textContent = text;
}

function showWelcome() {
  ui.addMessage(
    "assistant",
    getMode() === "local"
      ? "Systems online. No AI is connected, so I'm in local mode and can only echo what you type."
      : "Systems online. Secure link established. How can I help?"
  );
}

function enterApp(statusText) {
  setStatus(statusText);
  showView("app");
  if (messagesEl.childElementCount === 0) showWelcome();
}

function contextWindow() {
  const slice = history.slice(-CONFIG.MAX_CONTEXT_MESSAGES);
  while (slice.length && slice[0].role !== "user") slice.shift(); // must start with a user message
  return slice;
}

async function handleSend() {
  const text = input.value.trim();
  if (!text || busy) return;

  busy = true;
  ui.setBusy(true);
  history.push({ role: "user", content: text });
  const userEl = ui.addMessage("user", text);
  ui.setInput("");
  const pendingEl = ui.addMessage("assistant", "Processing…", "pending");

  try {
    const reply = await sendMessage(contextWindow());
    history.push({ role: "assistant", content: reply });
    pendingEl.remove();
    ui.addMessage("assistant", reply);
    if (getMode() === "online") setStatus("SECURE LINK");
  } catch (err) {
    history.pop(); // forget the unanswered message so the next try starts clean
    userEl.remove();
    pendingEl.remove();
    ui.setInput(text); // give the text back so nothing is lost
    ui.addMessage("assistant", errorText(err), "failed");
    if (err.message === "network_error") setStatus("OFFLINE");
    if (err.message === "unauthorized") showView("login");
  } finally {
    busy = false;
    ui.setBusy(false);
  }
}

function newChat() {
  history = [];
  ui.clear();
  showWelcome();
}

async function handleLock() {
  try {
    await logout();
  } catch {
    /* even if the server is unreachable, lock the screen locally */
  }
  history = [];
  ui.clear();
  authUI.clear();
  authUI.hideError();
  showView("login");
}

async function handleLogin(event) {
  event.preventDefault();
  authUI.hideError();
  authUI.setBusy(true);
  try {
    await login(authUI.value());
    authUI.clear();
    enterApp("SECURE LINK");
  } catch (err) {
    authUI.showError(loginErrorText(err));
  } finally {
    authUI.setBusy(false);
    if (!views.login.hidden) authUI.focus();
  }
}

async function init() {
  $("lock").hidden = getMode() === "local";
  if (getMode() === "local") {
    enterApp("LOCAL MODE");
    return;
  }
  try {
    const session = await getSession();
    if (session.authenticated) enterApp("SECURE LINK");
    else showView("login");
  } catch (err) {
    // No connection: still open the app shell. The server refuses chat without a valid login anyway.
    if (err.message === "network_error") enterApp("OFFLINE");
    else showView("login");
  }
}

$("login-form").addEventListener("submit", handleLogin);

$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  handleSend();
});

input.addEventListener("input", ui.autosize);

// Phones: Enter = new line (use the Send button). Computers: Enter sends, Shift+Enter = new line.
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && window.matchMedia("(pointer: fine)").matches) {
    event.preventDefault();
    handleSend();
  }
});

$("new-chat").addEventListener("click", newChat);
$("lock").addEventListener("click", handleLock);

registerServiceWorker();
setupInstallButton($("install"));
init();
