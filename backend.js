// The ONLY file that talks to the backend. To change hosting or AI provider later,
// change this file and the backend; the screens stay the same.
//
//   GET  /api/session  -> { authenticated }
//   POST /api/login    { passphrase }  -> { ok }  (sets an HttpOnly cookie the page cannot read)
//   POST /api/logout   -> { ok }
//   POST /api/chat     { messages }    -> { reply, provider, model }          (Phase 2 form, stores nothing)
//   POST /api/chat     { conversationId?, message } -> { reply, conversationId, title, saved,
//                         memoriesUsed, memoryEvents, memoryProposals }          (Phase 3: history + memory)
//   /api/conversations, /api/conversations/:id, /api/memories, /api/memories/:id  (Phase 3 storage)
//   Errors: non-2xx with { error: "code", retryAfter?, missing? }

import { CONFIG } from "./config.js";

export function getMode() {
  return CONFIG.USE_BACKEND ? "online" : "local";
}

function apiError(code, status = 0) {
  const err = new Error(code);
  err.status = status;
  return err;
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw apiError("network_error");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = apiError(data?.error || `http_${res.status}`, res.status);
    err.retryAfter = Number(res.headers.get("Retry-After")) || Number(data?.retryAfter) || 0;
    err.missing = Array.isArray(data?.missing) ? data.missing : [];
    err.similar = Array.isArray(data?.similar) ? data.similar : data?.existing ? [data.existing] : [];
    throw err;
  }
  return data;
}

export async function getSession() {
  if (getMode() === "local") return { authenticated: true };
  return request("/api/session");
}

export async function login(passphrase) {
  return request("/api/login", { method: "POST", body: JSON.stringify({ passphrase }) });
}

export async function logout() {
  if (getMode() === "local") return;
  await request("/api/logout", { method: "POST", body: "{}" });
}

function localReply(messages) {
  const last = messages[messages.length - 1]?.content ?? "";
  const shown = last.length > 300 ? `${last.slice(0, 300)}…` : last;
  return new Promise((resolve) => {
    setTimeout(
      () => resolve("Local mode: no AI is connected, so I can only echo your message.\n\nYou said: " + shown),
      450
    );
  });
}

export async function sendMessage(messages) {
  if (getMode() === "local") return localReply(messages);
  const data = await request("/api/chat", { method: "POST", body: JSON.stringify({ messages }) });
  if (typeof data?.reply !== "string") throw apiError("bad_response");
  return data.reply;
}

// ---------------------------------------------------------------- Phase 3 storage
const jsonBody = (value) => JSON.stringify(value);

// Sends one message in a stored conversation. conversationId = null starts a new one.
export async function sendStoredMessage(message, conversationId) {
  if (getMode() === "local") {
    const reply = await localReply([{ role: "user", content: message }]);
    return { reply, conversationId: null, title: null, saved: false, memoriesUsed: [], memoryEvents: [], memoryProposals: [] };
  }
  const body = conversationId ? { message, conversationId } : { message };
  const data = await request("/api/chat", { method: "POST", body: jsonBody(body) });
  if (typeof data?.reply !== "string") throw apiError("bad_response");
  return {
    reply: data.reply,
    conversationId: data.conversationId ?? null,
    title: data.title ?? null,
    saved: data.saved !== false,
    memoriesUsed: Array.isArray(data.memoriesUsed) ? data.memoriesUsed : [],
    memoryEvents: Array.isArray(data.memoryEvents) ? data.memoryEvents : [],
    memoryProposals: Array.isArray(data.memoryProposals) ? data.memoryProposals : [],
  };
}

export const listConversations = async () => (await request("/api/conversations")).conversations ?? [];
export const getConversation = (id) => request(`/api/conversations/${encodeURIComponent(id)}`);
export const renameConversation = (id, title) =>
  request(`/api/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body: jsonBody({ title }) });
export const deleteConversation = (id) => request(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });

export async function listMemories({ q = "", category = "" } = {}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  const qs = params.toString();
  return request(`/api/memories${qs ? `?${qs}` : ""}`);
}
export const createMemory = (fields) => request("/api/memories", { method: "POST", body: jsonBody(fields) });
export const updateMemory = (id, fields) =>
  request(`/api/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: jsonBody(fields) });
export const deleteMemory = (id) => request(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
export const clearMemories = () =>
  request("/api/memories", { method: "DELETE", body: jsonBody({ confirm: "DELETE_ALL_MEMORIES" }) });
