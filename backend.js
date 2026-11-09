// The ONLY file that talks to a backend. To switch AI providers or hosting
// later, change this file (and the backend); the interface code stays the same.
//
// Contract with the future backend:
//   POST {API_BASE_URL}/api/chat   body: { messages: [{ role, content }] }
//   200 -> { reply: "text" }       error -> { error: "code" } with a non-200 status

import { CONFIG } from "./config.js";

export function getMode() {
  return CONFIG.API_BASE_URL ? "online" : "local";
}

function localReply(messages) {
  const last = messages[messages.length - 1]?.content ?? "";
  const shown = last.length > 300 ? `${last.slice(0, 300)}…` : last;
  return new Promise((resolve) => {
    setTimeout(
      () =>
        resolve(
          "Local mode: no AI is connected yet, so I can only echo your message.\n\nYou said: " +
            shown
        ),
      450
    );
  });
}

async function remoteReply(messages) {
  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE_URL}/api/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new Error("network_error");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (typeof data?.reply !== "string") throw new Error("bad_response");
  return data.reply;
}

export function sendMessage(messages) {
  return getMode() === "online" ? remoteReply(messages) : localReply(messages);
}
