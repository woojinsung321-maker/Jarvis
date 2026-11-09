/**
 * JARVIS Phase 2 backend.
 *
 * One self-contained Cloudflare Pages "advanced mode" Worker (this file must stay named
 * _worker.js and sit in the site root). It only receives /api/* requests (see _routes.json);
 * everything else is served directly by Cloudflare as static files.
 *
 * Secrets (set in the Cloudflare dashboard, NEVER in GitHub or in frontend files):
 *   OWNER_PASSPHRASE  your login passphrase (at least 16 characters)
 *   SESSION_SECRET    random text used to sign login cookies (at least 32 characters)
 *   GEMINI_API_KEY    your Google AI Studio key
 * Optional plain variable:
 *   GEMINI_MODELS     comma-separated model names, tried in order (max 4)
 *
 * Routes:
 *   GET  /api/session   is this browser logged in?
 *   POST /api/login     passphrase -> signed HttpOnly session cookie
 *   POST /api/logout    clears the cookie
 *   POST /api/chat      (login required) messages -> Gemini reply
 *   GET  /api/models    (login required) lists Gemini models your key can use
 *   GET  /api/diagnostics  (login required) makes a tiny REAL Gemini call and reports the evidence
 */

// ---------------------------------------------------------------- settings
const COOKIE_NAME = "__Host-jarvis_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MIN_PASSPHRASE_LENGTH = 16;
const MIN_SESSION_SECRET_LENGTH = 32;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 8000;
const GEMINI_TIMEOUT_MS = 25000;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Flash-Lite first (most generous free quota), then the newest Flash.
const DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];

const LIMITS = {
  loginAttempts: { max: 5, windowMs: 15 * 60 * 1000 }, // per IP address
  chat: { max: 20, windowMs: 60 * 1000 }, // per login session
  diagnostics: { max: 3, windowMs: 5 * 60 * 1000 }, // per login session (each run uses free Gemini quota)
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ----------------------------------------------------------------- helpers
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders,
    },
  });
}

function fail(code, status, extra = {}, headers = {}) {
  return json({ error: code, ...extra }, status, headers);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "unknown";

// CSRF defence for state-changing requests (the cookie is also SameSite=Strict).
const sameOrigin = (request, url) => request.headers.get("Origin") === url.origin;

async function readJson(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.startsWith("application/json")) return { error: fail("unsupported_media_type", 415) };
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) {
    return { error: fail("payload_too_large", 413) };
  }
  const text = await request.text();
  if (encoder.encode(text).length > MAX_BODY_BYTES) return { error: fail("payload_too_large", 413) };
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: fail("bad_request", 400) };
  }
}

// ------------------------------------------------------------ configuration
// Returns the NAMES of missing/weak settings (never their values).
function configProblems(env, names) {
  const problems = [];
  for (const name of names) {
    const value = typeof env[name] === "string" ? env[name] : "";
    if (!value) problems.push(name);
    else if (name === "OWNER_PASSPHRASE" && value.length < MIN_PASSPHRASE_LENGTH) {
      problems.push(`OWNER_PASSPHRASE (needs at least ${MIN_PASSPHRASE_LENGTH} characters)`);
    } else if (name === "SESSION_SECRET" && value.length < MIN_SESSION_SECRET_LENGTH) {
      problems.push(`SESSION_SECRET (needs at least ${MIN_SESSION_SECRET_LENGTH} characters)`);
    }
  }
  return problems;
}

// ------------------------------------------------------------- rate limiting
// Kept in this Worker's memory: it is best-effort (a restart or a second server instance
// starts a fresh count). It stops loops and casual guessing; the 16+ character passphrase
// is the real protection. Durable limits can use Phase 3 storage.
const hits = new Map();
const LONGEST_WINDOW_MS = 15 * 60 * 1000;

function recentHits(key, windowMs, now) {
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  hits.set(key, list);
  return list;
}

function isLimited(key, rule, now = Date.now()) {
  return recentHits(key, rule.windowMs, now).length >= rule.max;
}

function recordHit(key, rule, now = Date.now()) {
  recentHits(key, rule.windowMs, now).push(now);
  if (hits.size > 500) {
    for (const [k, list] of hits) {
      if (!list.length || now - list[list.length - 1] > LONGEST_WINDOW_MS) hits.delete(k);
    }
  }
}

function tooMany(code, key, rule, now = Date.now()) {
  const list = recentHits(key, rule.windowMs, now);
  const wait = list.length ? Math.max(1, Math.ceil((list[0] + rule.windowMs - now) / 1000)) : 1;
  return fail(code, 429, { retryAfter: wait }, { "Retry-After": String(wait) });
}

// ----------------------------------------------------------------- sessions
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

// Compares hashes so response time does not reveal how much of the passphrase matched.
async function passphraseMatches(supplied, expected) {
  const [a, b] = await Promise.all([sha256(supplied), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function createSession(secret, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const payload = b64urlEncode(
    encoder.encode(JSON.stringify({ sid: hex(crypto.getRandomValues(new Uint8Array(16))), iat, exp: iat + SESSION_TTL_SECONDS }))
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)));
  return `${payload}.${b64urlEncode(sig)}`;
}

function getCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Returns { sid } for a valid, unexpired, correctly signed cookie, otherwise null.
async function readSession(request, env, now = Date.now()) {
  const secret = typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET : "";
  if (secret.length < MIN_SESSION_SECRET_LENGTH) return null;
  const parts = (getCookie(request, COOKIE_NAME) || "").split(".");
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlDecode(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const { sid, exp } = JSON.parse(decoder.decode(b64urlDecode(parts[0])));
    if (typeof sid !== "string" || typeof exp !== "number" || exp <= Math.floor(now / 1000)) return null;
    return { sid };
  } catch {
    return null;
  }
}

const sessionCookie = (token) =>
  `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
const clearedCookie = () => `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

// ---------------------------------------------------------- AI provider: Gemini
// To add Groq/OpenRouter later: write another object with the same shape and register it
// in PROVIDERS. A provider is { id, chat({ messages, system, env }) -> { text, model } }.
class ProviderError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// The key is pasted by hand: ignore stray spaces, line breaks and wrapping quotes.
function geminiKey(env) {
  if (typeof env.GEMINI_API_KEY !== "string") return "";
  return env.GEMINI_API_KEY.trim().replace(/^["']+|["']+$/g, "").trim();
}

// Removes every secret value (and anything shaped like a Google key) before text is logged or returned.
function redact(text, env) {
  let out = String(text ?? "");
  const values = [geminiKey(env)];
  for (const name of ["GEMINI_API_KEY", "OWNER_PASSPHRASE", "SESSION_SECRET"]) {
    if (typeof env[name] === "string") values.push(env[name].trim());
  }
  for (const value of values) if (value.length >= 8) out = out.split(value).join("[redacted]");
  return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]");
}

function geminiModels(env) {
  const raw = String(env.GEMINI_MODELS || env.GEMINI_MODEL || "");
  const list = raw.split(",").map((m) => m.trim()).filter((m) => /^[A-Za-z0-9._-]+$/.test(m));
  return list.length ? list.slice(0, 4) : DEFAULT_MODELS;
}

async function geminiErrorMessage(res, env) {
  try {
    const data = await res.json();
    return redact(String(data?.error?.message || "").slice(0, 200), env);
  } catch {
    return "";
  }
}

async function geminiFetch(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractGeminiText(data) {
  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
  const blocked =
    Boolean(data?.promptFeedback?.blockReason) ||
    ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(candidate?.finishReason);
  return { text, blocked };
}

const gemini = {
  id: "gemini",

  async chat({ messages, system, env }) {
    const apiKey = geminiKey(env);
    if (!apiKey) throw new ProviderError("provider_not_configured", 500);

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
    });

    const models = geminiModels(env);
    let sawRateLimit = false;
    let notFound = 0;
    let lastError = "provider_error";

    for (const model of models) {
      let res;
      try {
        res = await geminiFetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, // key goes in a header, never in the URL
          body,
        });
      } catch (err) {
        console.error(`Gemini request failed (${model}): ${err?.name}`);
        lastError = "provider_unavailable";
        continue;
      }

      if (res.status === 429) { sawRateLimit = true; continue; }
      if (res.status === 404) { notFound++; continue; }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        console.error(`Gemini HTTP ${res.status} (${model}): ${await geminiErrorMessage(res, env)}`);
        throw new ProviderError("provider_rejected_request", 502); // key/request problem: other models will not help
      }
      if (!res.ok) {
        console.error(`Gemini HTTP ${res.status} (${model})`);
        lastError = "provider_error";
        continue;
      }

      let data = null;
      try { data = await res.json(); } catch { /* handled below */ }
      const { text, blocked } = extractGeminiText(data);
      if (text) return { text, model };
      if (blocked) throw new ProviderError("blocked_by_provider", 502);
      lastError = "empty_reply";
    }

    if (sawRateLimit) throw new ProviderError("rate_limited", 429);
    if (notFound === models.length) throw new ProviderError("model_not_found", 502);
    throw new ProviderError(lastError, 502);
  },

  async listModels(env) {
    const res = await geminiFetch(`${GEMINI_BASE}/models?pageSize=200`, {
      headers: { "x-goog-api-key": geminiKey(env) },
    });
    if (!res.ok) throw new ProviderError(res.status === 429 ? "rate_limited" : "provider_rejected_request", 502);
    const data = await res.json();
    return (data?.models ?? [])
      .filter((m) => (m?.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter(Boolean)
      .sort();
  },
};

const PROVIDERS = { [gemini.id]: gemini };

function systemPrompt(now = new Date()) {
  return (
    "You are JARVIS, the private personal assistant of a single owner. " +
    "Be concise, clear and practical. " +
    "You currently have no tools, no memory between chats and no internet access. " +
    "Never claim to have done something you cannot do. " +
    `Today's date (UTC) is ${now.toISOString().slice(0, 10)}.`
  );
}

// ------------------------------------------------------------------- routes
function validateMessages(body) {
  const list = body?.messages;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MESSAGES) return null;
  const out = [];
  for (const m of list) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    const content = m.content.trim();
    if (!content || content.length > MAX_MESSAGE_CHARS) return null;
    out.push({ role: m.role, content });
  }
  if (out[0].role !== "user" || out[out.length - 1].role !== "user") return null;
  return out;
}

async function handleSession(request, env) {
  const session = await readSession(request, env);
  return json(session ? { authenticated: true, provider: "gemini" } : { authenticated: false });
}

async function handleLogin(request, env, url) {
  if (!sameOrigin(request, url)) return fail("forbidden", 403);
  const problems = configProblems(env, ["OWNER_PASSPHRASE", "SESSION_SECRET"]);
  if (problems.length) return fail("server_not_configured", 500, { missing: problems });

  const key = `login:${clientIp(request)}`;
  if (isLimited(key, LIMITS.loginAttempts)) return tooMany("too_many_attempts", key, LIMITS.loginAttempts);
  recordHit(key, LIMITS.loginAttempts); // count the attempt up front so parallel guesses cannot slip through

  const body = await readJson(request);
  if (body.error) return body.error;
  const supplied = typeof body.data?.passphrase === "string" ? body.data.passphrase : "";

  if (!(await passphraseMatches(supplied, env.OWNER_PASSPHRASE))) {
    await sleep(750);
    return fail("invalid_credentials", 401);
  }
  hits.delete(key); // successful login clears the failure count
  const token = await createSession(env.SESSION_SECRET);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
}

async function handleLogout(request, env, url) {
  if (!sameOrigin(request, url)) return fail("forbidden", 403);
  return json({ ok: true }, 200, { "Set-Cookie": clearedCookie() });
}

async function handleChat(request, env, url) {
  if (!sameOrigin(request, url)) return fail("forbidden", 403);
  const session = await readSession(request, env);
  if (!session) return fail("unauthorized", 401);

  const key = `chat:${session.sid}`;
  if (isLimited(key, LIMITS.chat)) return tooMany("too_many_requests", key, LIMITS.chat);
  recordHit(key, LIMITS.chat);

  const body = await readJson(request);
  if (body.error) return body.error;
  const messages = validateMessages(body.data);
  if (!messages) return fail("bad_request", 400);

  try {
    const provider = PROVIDERS[String(env.AI_PROVIDER || "gemini")] || gemini;
    const { text, model } = await provider.chat({ messages, system: systemPrompt(), env });
    return json({ reply: text, provider: provider.id, model });
  } catch (err) {
    if (err instanceof ProviderError) return fail(err.code, err.status);
    console.error("Chat error:", err?.name);
    return fail("server_error", 500);
  }
}

async function handleModels(request, env) {
  if (!(await readSession(request, env))) return fail("unauthorized", 401);
  if (!geminiKey(env)) return fail("provider_not_configured", 500);
  try {
    return json({ configured: geminiModels(env), available: await gemini.listModels(env) });
  } catch (err) {
    return fail(err instanceof ProviderError ? err.code : "provider_error", 502);
  }
}

// ------------------------------------------------------------- diagnostics
// A tiny REAL Gemini call whose result proves (or disproves) that the key, the model name and
// the connection work. The report contains only statuses, timings and Gemini's own short reply.
// It never contains the key, the passphrase or the session secret (all values are redacted).
const DIAGNOSTIC_PROMPT = "Reply with exactly the single word: OK";

const VERDICT_HINTS = {
  gemini_working: "Gemini answered. Chat uses the first working model in the list.",
  key_missing: "GEMINI_API_KEY is not visible to the Worker. Add it as a Production secret, then retry the deployment.",
  key_or_request_rejected: "Google rejected the key. Create a new key at aistudio.google.com, replace the GEMINI_API_KEY secret, then retry the deployment.",
  rate_limited_or_quota_exhausted: "The key may be fine but this model's free quota is used up (or is 0). Wait, or put other models in GEMINI_MODELS (see /api/models).",
  model_not_found: "None of the configured model names exist. Open /api/models and put names from that list into GEMINI_MODELS.",
  gemini_unreachable_or_error: "Google did not answer properly. Try again in a minute.",
};

function describeSecret(env, name) {
  const value = typeof env[name] === "string" ? env[name] : "";
  const configProblem = configProblems(env, [name])[0];
  if (!value) return "missing";
  return configProblem ? "too_short" : "set";
}

async function probeGemini(model, env) {
  const started = Date.now();
  const result = { model, ok: false, httpStatus: null, latencyMs: 0 };
  try {
    const res = await geminiFetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey(env) },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: DIAGNOSTIC_PROMPT }] }],
        generationConfig: { maxOutputTokens: 256, temperature: 0 },
      }),
    });
    result.httpStatus = res.status;
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      result.googleStatus = String(data?.error?.status || "").slice(0, 40) || undefined;
      const reason = (data?.error?.details ?? []).find((d) => typeof d?.reason === "string")?.reason;
      if (reason) result.reason = String(reason).slice(0, 60);
      result.message = redact(data?.error?.message, env).slice(0, 200);
    } else {
      const { text, blocked } = extractGeminiText(data);
      result.ok = Boolean(text);
      result.replyPreview = redact(text, env).slice(0, 40);
      if (!text) result.note = blocked ? "blocked_by_provider" : "empty_reply";
      if (typeof data?.modelVersion === "string") result.modelVersion = redact(data.modelVersion, env).slice(0, 60);
      const usage = data?.usageMetadata;
      if (Number.isFinite(usage?.promptTokenCount)) {
        result.tokens = { prompt: usage.promptTokenCount, output: Number.isFinite(usage.candidatesTokenCount) ? usage.candidatesTokenCount : 0 };
      }
    }
  } catch (err) {
    result.error = err?.name === "AbortError" ? "timeout" : "network_error";
  }
  result.latencyMs = Date.now() - started;
  return result;
}

function diagnosticVerdict(tests) {
  if (tests.some((t) => t.ok)) return "gemini_working";
  if (tests.some((t) => [400, 401, 403].includes(t.httpStatus))) return "key_or_request_rejected";
  if (tests.some((t) => t.httpStatus === 429)) return "rate_limited_or_quota_exhausted";
  if (tests.length && tests.every((t) => t.httpStatus === 404)) return "model_not_found";
  return "gemini_unreachable_or_error";
}

async function handleDiagnostics(request, env, url) {
  const session = await readSession(request, env);
  if (!session) return fail("unauthorized", 401);

  const limitKey = `diag:${session.sid}`;
  if (isLimited(limitKey, LIMITS.diagnostics)) return tooMany("too_many_requests", limitKey, LIMITS.diagnostics);
  recordHit(limitKey, LIMITS.diagnostics);

  const apiKey = geminiKey(env);
  const models = geminiModels(env);
  const config = {
    provider: "gemini",
    OWNER_PASSPHRASE: describeSecret(env, "OWNER_PASSPHRASE"),
    SESSION_SECRET: describeSecret(env, "SESSION_SECRET"),
    GEMINI_API_KEY: apiKey ? "set" : "missing",
    geminiKeyFormat: apiKey ? (/^AIza[0-9A-Za-z_-]{30,}$/.test(apiKey) ? "looks_like_a_google_key" : "unexpected_format") : undefined,
    geminiKeyHadStrayWhitespaceOrQuotes: apiKey && apiKey !== env.GEMINI_API_KEY ? true : undefined,
    models,
    modelsSource: env.GEMINI_MODELS || env.GEMINI_MODEL ? "GEMINI_MODELS setting" : "built-in default",
  };

  const tests = [];
  let verdict = "key_missing";
  if (apiKey) {
    const testAll = url.searchParams.get("all") === "1";
    for (const model of models) {
      const result = await probeGemini(model, env);
      tests.push(result);
      if (result.ok && !testAll) break;
    }
    verdict = diagnosticVerdict(tests);
  }
  return json({ ok: verdict === "gemini_working", verdict, hint: VERDICT_HINTS[verdict], checkedAt: new Date().toISOString(), config, tests });
}

const ROUTES = {
  "/api/session": { GET: handleSession },
  "/api/login": { POST: handleLogin },
  "/api/logout": { POST: handleLogout },
  "/api/chat": { POST: handleChat },
  "/api/models": { GET: handleModels },
  "/api/diagnostics": { GET: handleDiagnostics },
};

async function handleApi(request, env, url) {
  const route = ROUTES[url.pathname.replace(/\/+$/, "")];
  if (!route) return fail("not_found", 404);
  const handler = route[request.method];
  if (!handler) return fail("method_not_allowed", 405, {}, { Allow: Object.keys(route).join(", ") });
  return handler(request, env, url);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      console.error("Unhandled error:", err?.name);
      return fail("server_error", 500);
    }
  },
};
