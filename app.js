// Entry point: connects the screens (chat-ui, auth, history, memory), the backend adapter and the PWA helpers.

import { CONFIG } from "./config.js";
import * as api from "./backend.js";
import { createChatUI } from "./chat-ui.js";
import { createAuthUI } from "./auth.js";
import { createDialogs } from "./dialogs.js";
import { createHistoryUI } from "./history-ui.js";
import { createMemoryUI, categoryLabel } from "./memory-ui.js";
import { createVoiceUI } from "./voice-ui.js";
import { registerServiceWorker, setupInstallButton } from "./pwa.js";

const { getMode, getSession, login, logout, sendMessage } = api;
const $ = (id) => document.getElementById(id);
const input = $("input");
const messagesEl = $("messages");

const ui = createChatUI({ messages: messagesEl, input, send: $("send") });
const authUI = createAuthUI({ input: $("passphrase"), button: $("login-button"), error: $("login-error") });
const views = { login: $("login"), app: $("app") };

const dialogs = createDialogs({
  dialog: $("dialog"), title: $("dialog-title"), message: $("dialog-message"), input: $("dialog-input"),
  error: $("dialog-error"), cancel: $("dialog-cancel"), ok: $("dialog-ok"), toast: $("toast"),
});

// Phase 4: voice. Builds the mic, speak/stop/replay controls and the voice settings screen. Never blocks text chat.
const voice = createVoiceUI({
  els: {
    mic: $("mic"), status: $("voice-status"), statusText: $("voice-status-text"), toggle: $("voice-toggle"),
    replay: $("voice-replay"), stop: $("voice-stop"), openButton: $("open-voice"), closeButton: $("close-voice"),
    panel: $("voice-panel"), enabled: $("vs-enabled"), rate: $("vs-rate"), rateValue: $("vs-rate-value"),
    voiceSelect: $("vs-voice"), voiceHint: $("vs-voice-hint"), test: $("vs-test"),
    inputStatus: $("vs-input-status"), outputStatus: $("vs-output-status"), composerInput: input,
  },
  getInput: () => input.value,
  setInput: (text) => ui.setInput(text),
  toast: (text, options) => dialogs.toast(text, options),
});

// storage: true = server has the D1 database (history + memory on); false = off; null = not known yet.
const state = { conversationId: null, storage: null, busy: false, warnedOff: false };
let legacyHistory = []; // only used when storage is off: [{ role, content }] kept in memory

function waitText(seconds) {
  return seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${Math.max(1, seconds)} seconds`;
}

function errorText(err) {
  switch (err.message) {
    case "network_error": return "Cannot reach the server. Check your connection.";
    case "unauthorized": return "Your session ended. Please sign in again.";
    case "too_many_requests": return `Too many requests too fast. Try again in ${waitText(err.retryAfter)}.`;
    case "rate_limited": return "The free Gemini limit was reached. Wait a bit and try again.";
    case "model_not_found": return "No configured Gemini model was found. See README (GEMINI_MODELS).";
    case "provider_not_configured": return "The Gemini key is not set on the server. See README.";
    case "provider_rejected_request": return "Gemini rejected the request. Check the API key.";
    case "blocked_by_provider": return "Gemini declined to answer that.";
    case "empty_reply": return "Gemini returned an empty reply. Try rephrasing.";
    case "provider_unavailable":
    case "provider_error": return "Gemini is not responding right now. Try again shortly.";
    case "payload_too_large": return "That is too long to send.";
    case "forbidden": return "The request was blocked. Reload the app and try again.";
    case "bad_response": return "The server sent an unexpected reply.";
    case "database_not_configured": return "The database is not connected. See README (D1 binding named DB).";
    case "database_not_migrated": return "The database tables are missing. Run the migration (see README).";
    case "not_found": return "That item no longer exists.";
    case "conversation_full": return "This conversation is full. Start a new chat.";
    case "conversation_limit_reached": return "Too many saved conversations. Delete some old ones first.";
    case "duplicate_memory": return "That memory already exists.";
    case "similar_memory_exists": return "A similar memory already exists.";
    case "contains_secret": return "Not saved: it looks like a password, key or token. Memory never stores those.";
    case "memory_too_long": return "Keep a memory under 500 characters.";
    case "memory_limit_reached": return "The memory is full (500). Delete some memories first.";
    case "bad_request": return "That input was not accepted. Check it and try again.";
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

function setStatus(text) {
  $("status-text").textContent = text;
}

// ------------------------------------------------------------- panels
function closePanels() {
  voice.reset();
  historyUI.close();
  memoryUI.reset();
  dialogs.cancelAll();
}

function showView(name) {
  views.login.hidden = name !== "login";
  views.app.hidden = name !== "app";
  if (name === "login") {
    closePanels();
    authUI.focus();
  }
}

function sessionEnded() {
  voice.reset();
  state.conversationId = null;
  legacyHistory = [];
  ui.clear();
  historyUI.render([]);
  showView("login");
}

const historyUI = createHistoryUI({
  drawer: $("drawer"), backdrop: $("drawer-backdrop"), openButton: $("open-history"), closeButton: $("close-history"),
  newButton: $("drawer-new"), list: $("conv-list"), state: $("history-state"),
  onOpenDrawer: () => refreshHistory(),
  onOpenConversation: (id) => openConversation(id),
  onRename: (conv) => renameConv(conv),
  onDelete: (conv) => deleteConv(conv),
  onNew: () => newChat(),
});

const memoryUI = createMemoryUI({
  els: {
    panel: $("memory-panel"), openButton: $("open-memory"), closeButton: $("close-memory"), search: $("memory-search"),
    filters: $("memory-filters"), list: $("memory-list"), state: $("memory-state"), count: $("memory-count"),
    addButton: $("memory-add"), clearButton: $("memory-clear"),
    editor: {
      root: $("memory-editor"), form: $("editor-form"), title: $("editor-title"), category: $("editor-category"),
      content: $("editor-content"), count: $("editor-count"), error: $("editor-error"), similar: $("editor-similar"),
      cancel: $("editor-cancel"), force: $("editor-force"), save: $("editor-save"),
    },
  },
  api,
  dialogs,
  describeError: errorText,
  onUnauthorized: sessionEnded,
  onChanged: () => {},
});

// ----------------------------------------------------------- history list
let historyLoaded = false;

async function refreshHistory() {
  if (getMode() === "local" || state.storage === false) {
    historyUI.render([]);
    historyUI.setState(
      getMode() === "local" ? "History is off in local mode." : "History is off: the database is not connected. See README."
    );
    return;
  }
  if (!historyLoaded) historyUI.setState("Loading conversations…");
  try {
    const conversations = await api.listConversations();
    historyLoaded = true;
    state.storage = true;
    historyUI.render(conversations);
    historyUI.setActive(state.conversationId);
    historyUI.setState(conversations.length ? "" : "No conversations yet. Say something to JARVIS and it will appear here.");
  } catch (err) {
    if (err.message === "unauthorized") { sessionEnded(); return; }
    if (err.message === "database_not_configured" || err.message === "database_not_migrated") {
      if (err.message === "database_not_configured") state.storage = false;
      historyUI.render([]);
      historyUI.setState(errorText(err), "error");
      return;
    }
    historyUI.setState(errorText(err), "error");
  }
}

async function openConversation(id) {
  if (state.busy) { dialogs.toast("Wait for the current reply to finish."); return; }
  historyUI.close();
  voice.stopListening();
  voice.stopSpeaking();
  const loadingEl = ui.addMessage("assistant", "Loading conversation…", "pending");
  try {
    const data = await api.getConversation(id);
    ui.clear();
    state.conversationId = id;
    for (const m of data.messages ?? []) ui.addMessage(m.role, m.content);
    // Replay can read the last answer of an opened conversation (it is never spoken automatically).
    voice.setLastReply([...(data.messages ?? [])].reverse().find((m) => m.role === "assistant")?.content ?? "");
    if (!data.messages?.length) ui.addMessage("assistant", "This conversation is empty. Say something to continue it.");
    historyUI.setActive(id);
    ui.scrollToEnd();
  } catch (err) {
    loadingEl.remove();
    if (err.message === "unauthorized") { sessionEnded(); return; }
    ui.addMessage("assistant", errorText(err), "failed");
    if (err.message === "not_found") refreshHistory();
  }
}

async function renameConv(conv) {
  const result = await dialogs.ask({
    title: "Rename conversation",
    confirmLabel: "Rename",
    input: { value: conv.title, maxLength: 80, placeholder: "Conversation title" },
    validate: (v) => (v.trim() ? "" : "Enter a title."),
  });
  if (!result.ok) return;
  try {
    await api.renameConversation(conv.id, result.value.trim());
    dialogs.toast("Conversation renamed");
    await refreshHistory();
  } catch (err) {
    if (err.message === "unauthorized") { sessionEnded(); return; }
    dialogs.toast(errorText(err), { isError: true });
    if (err.message === "not_found") refreshHistory();
  }
}

async function deleteConv(conv) {
  const ok = await dialogs.confirm({
    title: "Delete conversation?",
    message: `“${conv.title}” and all its messages will be permanently deleted.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteConversation(conv.id);
    if (conv.id === state.conversationId) newChat();
    dialogs.toast("Conversation deleted");
    await refreshHistory();
  } catch (err) {
    if (err.message === "unauthorized") { sessionEnded(); return; }
    dialogs.toast(errorText(err), { isError: true });
    if (err.message === "not_found") refreshHistory();
  }
}

// ----------------------------------------------------------------- chat
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
  const slice = legacyHistory.slice(-CONFIG.MAX_CONTEXT_MESSAGES);
  while (slice.length && slice[0].role !== "user") slice.shift(); // must start with a user message
  return slice;
}

// Phase 2 style: nothing is stored; the browser keeps the conversation in memory.
async function deliverLegacy(text) {
  legacyHistory.push({ role: "user", content: text });
  try {
    const reply = await sendMessage(contextWindow());
    legacyHistory.push({ role: "assistant", content: reply });
    return { reply, stored: false };
  } catch (err) {
    legacyHistory.pop(); // forget the unanswered message so the next try starts clean
    throw err;
  }
}

// Tells the owner, once per sign-in, that this chat is not being saved.
function warnHistoryOff(reasonText) {
  if (state.warnedOff) return;
  state.warnedOff = true;
  ui.addNote({ kind: "warn", label: "History and memory off", text: `${reasonText} Chats are not being saved.` });
}

async function deliver(text) {
  if (getMode() === "local") return deliverLegacy(text);
  if (state.storage === false) {
    warnHistoryOff("The database is not connected. See README.");
    return deliverLegacy(text);
  }
  try {
    const result = await api.sendStoredMessage(text, state.conversationId);
    state.storage = true;
    return { ...result, stored: true };
  } catch (err) {
    if (err.message === "database_not_configured" || err.message === "database_not_migrated") {
      // The server has no usable database: keep chatting like Phase 2, and say so.
      if (err.message === "database_not_configured") state.storage = false;
      warnHistoryOff(errorText(err));
      return deliverLegacy(text);
    }
    throw err;
  }
}

const REJECTED = {
  secret: "Not saved: it looks like a password, key or token. JARVIS never stores those.",
  too_long: "Not saved: a memory must be under 500 characters.",
  limit: "Not saved: the memory is full (500). Delete some memories first.",
};

function showMemoryFeedback(result) {
  if (result.memoriesUsed.length) {
    ui.addNote({
      label: "Memory",
      text: `Used ${result.memoriesUsed.length} saved ${result.memoriesUsed.length === 1 ? "memory" : "memories"} for this answer.`,
      details: { summary: "Show", items: result.memoriesUsed.map((m) => `${categoryLabel(m.category)}: ${m.content}`) },
    });
  }

  for (const event of result.memoryEvents) {
    if (event.type === "saved") {
      ui.addNote({
        kind: "ok", label: "Memory saved", text: event.memory.content,
        actions: [{
          label: "Undo",
          run: async (note) => {
            try {
              await api.deleteMemory(event.memory.id);
              note.update({ kind: "info", label: "Memory removed", text: event.memory.content });
              note.clearActions();
            } catch (err) { dialogs.toast(errorText(err), { isError: true }); }
          },
        }],
      });
    } else if (event.type === "duplicate") {
      ui.addNote({ label: "Already remembered", text: event.memory.content });
    } else if (event.type === "similar") {
      const old = event.existing[0];
      ui.addNote({
        kind: "warn", label: "Similar memory exists",
        text: `Saved: “${old.content}”\nNew: “${event.content}”\nNothing was changed yet.`,
        actions: [
          {
            label: "Replace old",
            run: async (note) => {
              try {
                await api.updateMemory(old.id, { content: event.content, category: event.category });
                note.update({ kind: "ok", label: "Memory updated", text: event.content });
                note.clearActions();
              } catch (err) { dialogs.toast(errorText(err), { isError: true }); }
            },
          },
          {
            label: "Keep both",
            run: async (note) => {
              try {
                await api.createMemory({ content: event.content, category: event.category, source: "explicit", force: true });
                note.update({ kind: "ok", label: "Memory saved", text: event.content });
                note.clearActions();
              } catch (err) { dialogs.toast(errorText(err), { isError: true }); }
            },
          },
          { label: "Dismiss", run: async (note) => note.remove() },
        ],
      });
    } else if (event.type === "rejected") {
      ui.addNote({ kind: "warn", label: "Memory not saved", text: REJECTED[event.reason] ?? "Not saved." });
    }
  }

  for (const proposal of result.memoryProposals) {
    ui.addNote({
      label: `Remember this? · ${categoryLabel(proposal.category)}`, text: proposal.content,
      actions: [
        {
          label: "Save",
          run: async (note) => {
            try {
              await api.createMemory({ content: proposal.content, category: proposal.category, source: "suggested" });
              note.update({ kind: "ok", label: "Memory saved", text: proposal.content });
              note.clearActions();
            } catch (err) {
              if (err.message === "similar_memory_exists" || err.message === "duplicate_memory") {
                note.update({ label: "Already remembered", text: "A similar memory already exists." });
                note.clearActions();
              } else dialogs.toast(errorText(err), { isError: true });
            }
          },
        },
        { label: "No thanks", run: async (note) => note.remove() },
      ],
    });
  }
}

async function handleSend() {
  voice.stopListening(); // release the microphone first; late speech results are ignored
  const text = input.value.trim();
  if (!text || state.busy) return;

  voice.stopSpeaking();
  state.busy = true;
  ui.setBusy(true);
  const userEl = ui.addMessage("user", text);
  ui.setInput("");
  const pendingEl = ui.addMessage("assistant", "Processing…", "pending");

  try {
    const result = await deliver(text);
    pendingEl.remove();
    ui.addMessage("assistant", result.reply);
    voice.setLastReply(result.reply);
    voice.speakReply(result.reply); // only real Gemini replies reach this line; errors and notes are never spoken
    if (result.stored) {
      if (result.conversationId) state.conversationId = result.conversationId;
      if (!result.saved) {
        ui.addNote({ kind: "warn", label: "Not saved", text: "This reply could not be saved to your history." });
      }
      showMemoryFeedback(result);
      refreshHistory();
    }
    if (getMode() === "online") setStatus("SECURE LINK");
  } catch (err) {
    userEl.remove();
    pendingEl.remove();
    ui.setInput(text); // give the text back so nothing is lost
    ui.addMessage("assistant", errorText(err), "failed");
    if (err.message === "network_error") setStatus("OFFLINE");
    if (err.message === "unauthorized") sessionEnded();
    if (err.message === "not_found" && state.conversationId) {
      state.conversationId = null; // that conversation was deleted elsewhere
      refreshHistory();
    }
  } finally {
    state.busy = false;
    ui.setBusy(false);
  }
}

function newChat() {
  if (state.busy) { dialogs.toast("Wait for the current reply to finish."); return; }
  voice.reset();
  state.conversationId = null;
  legacyHistory = [];
  ui.clear();
  showWelcome();
  historyUI.setActive(null);
}

async function handleLock() {
  try {
    await logout();
  } catch {
    /* even if the server is unreachable, lock the screen locally */
  }
  voice.reset();
  state.conversationId = null;
  state.storage = null;
  state.warnedOff = false;
  historyLoaded = false;
  legacyHistory = [];
  ui.clear();
  historyUI.render([]);
  authUI.clear();
  authUI.hideError();
  showView("login");
}

async function learnStorage(session) {
  state.storage = session?.storage === true ? true : session?.authenticated ? false : null;
}

async function handleLogin(event) {
  event.preventDefault();
  authUI.hideError();
  authUI.setBusy(true);
  try {
    await login(authUI.value());
    authUI.clear();
    try { await learnStorage(await getSession()); } catch { state.storage = null; }
    enterApp("SECURE LINK");
  } catch (err) {
    authUI.showError(loginErrorText(err));
  } finally {
    authUI.setBusy(false);
    if (!views.login.hidden) authUI.focus();
  }
}

async function init() {
  const local = getMode() === "local";
  $("lock").hidden = local;
  $("open-history").hidden = local;
  $("open-memory").hidden = local;
  if (local) {
    state.storage = false;
    enterApp("LOCAL MODE");
    return;
  }
  try {
    const session = await getSession();
    if (session.authenticated) {
      await learnStorage(session);
      enterApp("SECURE LINK");
    } else showView("login");
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

// Escape closes the top-most panel (dialogs handle their own Escape).
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || dialogs.isOpen()) return;
  if (voice.isSheetOpen()) voice.closeSheet();
  else if (memoryUI.editorOpen()) memoryUI.closeEditor();
  else if (memoryUI.isOpen()) memoryUI.close();
  else if (historyUI.isOpen()) historyUI.close();
});

$("new-chat").addEventListener("click", newChat);
$("lock").addEventListener("click", handleLock);

registerServiceWorker();
setupInstallButton($("install"));
init();
