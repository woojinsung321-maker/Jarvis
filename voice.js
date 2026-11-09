// Phase 4 voice engine. No DOM and no network code in this file: it only wraps the browser's own
// SpeechRecognition and SpeechSynthesis, plus the saved voice preferences.
//
// Privacy facts (see README):
// - This code never records, stores or uploads audio. It never opens the microphone itself and has no network code.
// - The browser asks for the microphone only when recognition.start() runs, i.e. after the mic button is tapped.
// - Chrome/Android's SpeechRecognition is implemented by the browser, and Chrome sends the audio to Google's
//   speech service to transcribe it. JARVIS cannot change that; the voice screen says so.
//
// Wake-word note (future phase): createRecognizer({ mode }) only supports "push-to-talk" today. A wake-word mode
// would be another recognizer behind the same { start, stop, abort } interface, feeding the same callbacks.

export const STORAGE_KEY = "jarvis.voice.v1";
export const RATE_MIN = 0.5;
export const RATE_MAX = 2;
export const DEFAULT_SETTINGS = Object.freeze({ enabled: false, rate: 1, voiceURI: "" });

// ---------------------------------------------------------------- settings
export function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
  const rate = Number(raw.rate);
  if (Number.isFinite(rate)) out.rate = Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(rate * 10) / 10));
  if (typeof raw.voiceURI === "string" && raw.voiceURI.length <= 300) out.voiceURI = raw.voiceURI;
  return out;
}

// storage defaults to window.localStorage. Every access is wrapped: private mode or blocked storage must not break JARVIS.
export function createSettingsStore(storage) {
  const store = storage ?? (typeof window !== "undefined" ? safeLocalStorage() : null);
  let current = load();
  const listeners = new Set();

  function load() {
    try {
      const text = store?.getItem(STORAGE_KEY);
      return sanitizeSettings(text ? JSON.parse(text) : null);
    } catch {
      return sanitizeSettings(null);
    }
  }
  function persist() {
    try { store?.setItem(STORAGE_KEY, JSON.stringify(current)); return true; } catch { return false; }
  }
  return {
    get: () => ({ ...current }),
    set(patch) {
      current = sanitizeSettings({ ...current, ...patch });
      const saved = persist();
      for (const fn of listeners) fn({ ...current });
      return saved;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

function safeLocalStorage() {
  try { return window.localStorage; } catch { return null; }
}

// ------------------------------------------------------------ detection
// Detection never touches the microphone, so it never triggers a permission prompt.
export function detectSupport(win = typeof window !== "undefined" ? window : {}) {
  const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition || null;
  const secure = win.isSecureContext !== false;
  const hasSynthesis = Boolean(win.speechSynthesis && typeof win.SpeechSynthesisUtterance === "function");
  let recognitionReason = "";
  if (!Recognition) recognitionReason = "This browser does not support speech recognition. Chrome on Android does. You can still type.";
  else if (!secure) recognitionReason = "Speech recognition needs a secure (https) connection.";
  return {
    Recognition: secure ? Recognition : null,
    recognition: Boolean(Recognition) && secure,
    recognitionReason,
    synthesis: hasSynthesis,
    synthesisReason: hasSynthesis ? "" : "This browser cannot speak replies aloud. Text chat works as normal.",
  };
}

// ------------------------------------------------------- text for speech
// Gemini answers often contain Markdown. Reading symbols aloud sounds bad, so strip them.
const endSentence = (line) => (/[.!?:;,…]$/.test(line) || !line ? line : `${line}.`);

export function cleanForSpeech(text) {
  if (typeof text !== "string") return "";
  let t = text.replace(/\r\n?/g, "\n");
  t = t.replace(/```[\s\S]*?```/g, " (code block omitted) ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " link ");
  // Headings and list items end with a full stop so the voice pauses between them.
  t = t.replace(/^\s{0,3}#{1,6}\s+(.*?)\s*$/gm, (_, h) => endSentence(h));
  t = t.replace(/^\s*>\s?/gm, "");
  t = t.replace(/^\s*[-*•+]\s+(.*?)\s*$/gm, (_, h) => endSentence(h));
  t = t.replace(/^\s*\d+[.)]\s+(.*?)\s*$/gm, (_, h) => endSentence(h));
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
  t = t.replace(/(\*|_)([^*_\n]+)\1/g, "$2");
  t = t.replace(/^[-=*_]{3,}\s*$/gm, " ");
  t = t.replace(/\|/g, " ");
  t = t.replace(/\n{2,}/g, ". ").replace(/\n/g, " ");
  t = t.replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ");
  return t.trim();
}

// Some browsers (notably Chrome) silently stop long utterances, so speak in sentence-sized pieces.
export function chunkText(text, max = 220) {
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [clean];
  const chunks = [];
  let cur = "";
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ""; };
  for (const s of sentences) {
    if (s.length > max) {
      push();
      let rest = s;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(" ", max);
        if (cut < max / 2) cut = max;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut);
      }
      cur = rest;
    } else if ((cur + s).length > max) {
      push();
      cur = s;
    } else {
      cur += s;
    }
  }
  push();
  return chunks.filter(Boolean);
}

// ------------------------------------------------------ error wording
export function recognitionErrorText(code) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Allow the microphone for this site in your browser settings, then tap the mic again.";
    case "audio-capture": return "No microphone was found, or it is in use by another app.";
    case "no-speech": return "I didn't hear anything. Tap the mic and try again.";
    case "network": return "Speech recognition could not reach the browser's speech service. Check your connection, or type instead.";
    case "language-not-supported": return "This browser does not support speech recognition for your language.";
    case "start-failed": return "Could not start the microphone. Try again.";
    default: return "Speech recognition stopped unexpectedly. Try again, or type instead.";
  }
}

// ------------------------------------------------------- recognition
// One tap starts a session, the next tap stops it. A session never restarts by itself.
// states: idle -> starting -> listening -> stopping -> idle. "listening" is only reported after the
// browser says audio capture actually began, so the UI never claims the mic is live when it is not.
export function createRecognizer({ Recognition, lang, mode = "push-to-talk", onState, onText, onError }) {
  if (mode !== "push-to-talk") throw new Error("unsupported_mode");
  let rec = null;
  let session = null; // { id, base, finalText, interim, delivered }
  let nextId = 1;
  let state = "idle";

  const setState = (s) => { if (state !== s) { state = s; onState?.(s); } };

  function compose(sess) {
    const spoken = `${sess.finalText}${sess.interim}`.trim();
    if (!spoken) return sess.base;
    return sess.base ? `${sess.base}${/\s$/.test(sess.base) ? "" : " "}${spoken}` : spoken;
  }

  function finish(sess, errorCode) {
    if (!session || session.id !== sess.id) return;
    const had = Boolean(`${sess.finalText}${sess.interim}`.trim());
    // Whatever the browser managed to recognise stays in the box (interim text is committed on end).
    if (had) onText?.(compose({ ...sess, finalText: `${sess.finalText}${sess.interim}`, interim: "" }), { final: true });
    session = null;
    rec = null;
    setState("idle");
    if (errorCode && errorCode !== "aborted") onError?.(errorCode, { hadText: had });
    else if (!had) onError?.("no-speech", { hadText: false });
  }

  function start(baseText = "") {
    if (state !== "idle") return false;
    let r;
    try {
      r = new Recognition();
    } catch {
      onError?.("start-failed", { hadText: false });
      return false;
    }
    const sess = { id: nextId++, base: String(baseText).trim(), finalText: "", interim: "", userStopped: false, errorCode: "" };
    session = sess;
    rec = r;
    r.lang = lang || "en-US";
    r.continuous = false; // continuous mode duplicates text on several Android builds; a tap restarts instead
    r.interimResults = true;
    r.maxAlternatives = 1;

    const live = () => session && session.id === sess.id;
    r.onaudiostart = () => { if (live() && state !== "stopping") setState("listening"); };
    r.onresult = (event) => {
      if (!live()) return;
      if (state === "starting") setState("listening"); // results prove audio is being captured
      let finalText = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        const piece = res[0]?.transcript ?? "";
        if (res.isFinal) finalText += piece; else interim += piece;
      }
      sess.finalText = finalText;
      sess.interim = interim;
      onText?.(compose(sess), { final: false });
    };
    r.onerror = (event) => { if (live()) sess.errorCode = event?.error || "unknown"; };
    r.onend = () => finish(sess, sess.errorCode);

    setState("starting");
    try {
      r.start();
    } catch {
      session = null; rec = null;
      setState("idle");
      onError?.("start-failed", { hadText: false });
      return false;
    }
    return true;
  }

  // Graceful stop: the browser delivers what it has heard so far, then fires "end".
  function stop() {
    if (!rec || state === "idle") return;
    session.userStopped = true;
    setState("stopping");
    try { rec.stop(); } catch { abort(); }
  }

  // Immediate stop: no further text is delivered (used when sending, locking or leaving the page).
  function abort() {
    if (!rec) { setState("idle"); return; }
    const r = rec;
    session = null; // later events from this session are ignored
    rec = null;
    try { r.abort(); } catch { try { r.stop(); } catch { /* nothing else to do */ } }
    setState("idle");
  }

  return { start, stop, abort, getState: () => state };
}

// ---------------------------------------------------------- speaking
// Speaks one reply at a time, in chunks. stop() takes effect immediately.
export function createSpeaker({ synth, Utterance, getSettings, onState, onError }) {
  let token = 0;
  let speaking = false;
  let lastText = "";
  let voicesCache = [];

  const refreshVoices = () => { try { voicesCache = synth?.getVoices?.() ?? []; } catch { voicesCache = []; } return voicesCache; };
  if (synth) {
    refreshVoices();
    try { synth.addEventListener?.("voiceschanged", refreshVoices); } catch { /* old browsers */ }
  }

  const setSpeaking = (v) => { if (speaking !== v) { speaking = v; onState?.(v); } };

  function pickVoice(uri) {
    if (!uri) return null;
    return refreshVoices().find((v) => v.voiceURI === uri) ?? null; // a missing voice falls back to the default
  }

  // Returns false if there was nothing speakable.
  // remember:false is used by the "Test voice" button so it does not replace the reply that Replay repeats.
  function speak(text, { remember = true } = {}) {
    if (!synth || !Utterance) return false;
    const clean = cleanForSpeech(text);
    const chunks = chunkText(clean);
    if (!chunks.length) return false;
    if (remember) lastText = text;
    cancelInternal();
    const my = ++token;
    const settings = getSettings();
    const voice = pickVoice(settings.voiceURI);
    let index = 0;
    setSpeaking(true);

    const next = () => {
      if (my !== token) return;
      if (index >= chunks.length) { setSpeaking(false); return; }
      const u = new Utterance(chunks[index++]);
      u.rate = settings.rate;
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.onend = next;
      u.onerror = (event) => {
        if (my !== token) return;
        const code = event?.error || "unknown";
        if (code === "canceled" || code === "interrupted") return; // we caused it
        token++;
        setSpeaking(false);
        try { synth.cancel(); } catch { /* ignore */ }
        onError?.(code);
      };
      try { synth.speak(u); } catch { token++; setSpeaking(false); onError?.("synthesis-failed"); }
    };
    next();
    return true;
  }

  function cancelInternal() {
    token++;
    try { synth?.cancel(); } catch { /* ignore */ }
  }

  function stop() {
    cancelInternal();
    setSpeaking(false);
  }

  return {
    speak,
    stop,
    replay: () => (lastText ? speak(lastText) : false),
    setLast(text) { lastText = typeof text === "string" ? text : ""; },
    hasLast: () => cleanForSpeech(lastText).length > 0,
    isSpeaking: () => speaking,
    getVoices: refreshVoices,
    forget() { lastText = ""; },
  };
}
