// Central settings. Nothing in this file is a secret: it is delivered to every visitor.
// NEVER put API keys or passwords in any frontend file.

export const CONFIG = Object.freeze({
  // Leave empty for local demo mode (no AI, replies are generated on the phone).
  // In a later phase, put your backend address here, for example:
  //   "https://jarvis-api.yourname.workers.dev"
  // A web address is public information, not a secret.
  API_BASE_URL: "",

  MAX_CONTEXT_MESSAGES: 20, // how many recent messages are sent to the backend
});
