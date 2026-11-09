// The ONLY file that talks to the backend. To change hosting or AI provider later,
// change this file and the backend; the screens stay the same.
//
//   GET  /api/session  -> { authenticated }
//   POST /api/login    { passphrase }  -> { ok }  (sets an HttpOnly cookie the page cannot read)
//   POST /api/logout   -> { ok }
//   POST /api/chat     { messages }    -> { reply, provider, model }
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
