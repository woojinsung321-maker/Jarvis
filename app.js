// Entry point: connects the screen (chat-ui), the backend adapter and the PWA helpers.

import { CONFIG } from "./config.js";
import { sendMessage, getMode } from "./backend.js";
import { createChatUI } from "./chat-ui.js";
import { registerServiceWorker, setupInstallButton } from "./pwa.js";

const $ = (id) => document.getElementById(id);
const input = $("input");

const ui = createChatUI({ messages: $("messages"), input, send: $("send") });

let history = []; // [{ role: "user" | "assistant", content }] — kept in memory only
let busy = false;

function errorText(err) {
  switch (err.message) {
    case "network_error": return "Cannot reach the backend. Check your connection.";
    case "unauthorized": return "Access denied. Please sign in again.";
    case "rate_limited": return "The free AI limit was reached. Wait a minute and try again.";
    case "bad_response": return "The backend sent an unexpected reply.";
    default: return `Something went wrong (${err.message}).`;
  }
}

function showWelcome() {
  ui.addMessage(
    "assistant",
    getMode() === "local"
      ? "Systems online. Foundation phase active. No AI is connected yet, so I'm in local mode and can only echo what you type."
      : "Systems online. How can I help?"
  );
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
  } catch (err) {
    history.pop(); // forget the unanswered message so the next try starts clean
    userEl.remove();
    pendingEl.remove();
    ui.setInput(text); // give the text back so nothing is lost
    ui.addMessage("assistant", errorText(err), "failed");
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

$("status-text").textContent = getMode() === "local" ? "LOCAL MODE" : "ONLINE";
showWelcome();
registerServiceWorker();
setupInstallButton($("install"));
