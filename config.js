// Central settings. Nothing in this file is a secret: it is delivered to every visitor.
// NEVER put API keys or passwords in any frontend file. Real secrets live only in the
// Cloudflare dashboard (see README).

export const CONFIG = Object.freeze({
  // true  = use the secure backend (login + Gemini).
  // false = Phase 1 local demo mode (no login, replies are an echo made on the phone).
  USE_BACKEND: true,

  // Empty = the backend lives on the same website address (this is how Phase 2 is deployed).
  API_BASE_URL: "",

  MAX_CONTEXT_MESSAGES: 20, // how many recent messages are sent with each request
});
