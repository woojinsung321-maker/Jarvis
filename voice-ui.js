// Draws and wires the voice controls: mic button, status line, speak/stop/replay buttons, voice settings sheet.
// Text is always set with textContent. All real work is in voice.js.
import {
  createSettingsStore, detectSupport, createRecognizer, createSpeaker, recognitionErrorText, RATE_MIN, RATE_MAX,
} from "./voice.js";

const TEST_SENTENCE = "This is JARVIS. Voice check complete. All systems online.";
const PERMISSION_ERRORS = new Set(["not-allowed", "service-not-allowed"]);

export function createVoiceUI({ els, getInput, setInput, toast, win = window, storage }) {
  const settings = createSettingsStore(storage);
  const support = detectSupport(win);
  const lang = (win.navigator?.language || "en-US");

  let recState = "idle";
  let speaking = false;
  let errorMessage = "";
  let errorTimer = null;
  let notice = ""; // e.g. "Review the text, then send."
  let noticeTimer = null;
  let returnFocus = null;

  // ------------------------------------------------------------ engines
  const speaker = support.synthesis
    ? createSpeaker({
        synth: win.speechSynthesis,
        Utterance: win.SpeechSynthesisUtterance,
        getSettings: settings.get,
        onState: (v) => { speaking = v; render(); },
        onError: (code) => {
          showError(code === "not-allowed"
            ? "The browser blocked automatic speech. Tap Replay to hear this reply."
            : "Could not speak that reply. Try Replay, or check your phone's text-to-speech settings.");
        },
      })
    : null;

  const recognizer = support.recognition
    ? createRecognizer({
        Recognition: support.Recognition,
        lang,
        onState: (s) => { recState = s; render(); },
        onText: (text, { final }) => {
          setInput(text);
          if (final) setNotice("Review or edit the text, then tap Send.");
        },
        onError: (code) => showError(recognitionErrorText(code), PERMISSION_ERRORS.has(code)),
      })
    : null;

  // ------------------------------------------------------------- status
  function showError(text, sticky = false) {
    errorMessage = text;
    clearTimeout(errorTimer);
    if (!sticky) errorTimer = setTimeout(() => { errorMessage = ""; render(); }, 9000);
    render();
  }
  function clearError() { errorMessage = ""; clearTimeout(errorTimer); }
  function setNotice(text) {
    notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = ""; render(); }, 8000);
    render();
  }

  function statusFor() {
    if (recState === "starting") return { key: "starting", text: "Starting microphone… allow access if asked" };
    if (recState === "listening") return { key: "listening", text: "Listening… tap the mic to stop" };
    if (recState === "stopping") return { key: "processing", text: "Finishing up…" };
    if (errorMessage) return { key: "error", text: errorMessage };
    if (speaking) return { key: "speaking", text: "Speaking… tap stop to silence" };
    if (notice) return { key: "idle", text: notice };
    if (!support.recognition && !support.synthesis) return { key: "idle", text: "Voice unavailable in this browser. Text chat works as normal." };
    if (!support.recognition) return { key: "idle", text: "Voice input unavailable here." + (settings.get().enabled ? " Spoken replies on." : "") };
    return { key: "idle", text: settings.get().enabled ? "Spoken replies on · tap the mic to talk" : "Tap the mic to talk" };
  }

  function render() {
    const s = statusFor();
    els.status.dataset.state = s.key;
    els.statusText.textContent = s.text;

    const active = recState === "starting" || recState === "listening";
    const busy = active || recState === "stopping";
    els.mic.classList.toggle("recording", recState === "listening");
    els.mic.classList.toggle("starting", recState === "starting" || recState === "stopping");
    els.mic.classList.toggle("unavailable", !support.recognition);
    els.mic.setAttribute("aria-pressed", String(active));
    els.mic.setAttribute("aria-disabled", String(!support.recognition));
    els.mic.setAttribute(
      "aria-label",
      !support.recognition ? "Voice input unavailable" : active ? "Stop voice input" : "Start voice input"
    );
    els.composerInput.classList.toggle("dictating", recState === "listening");

    const cfg = settings.get();
    els.toggle.setAttribute("aria-pressed", String(cfg.enabled && support.synthesis));
    els.toggle.classList.toggle("unavailable", !support.synthesis);
    els.toggle.setAttribute("aria-label", !support.synthesis ? "Spoken replies unavailable"
      : cfg.enabled ? "Spoken replies on. Tap to turn off" : "Spoken replies off. Tap to turn on");
    els.stop.disabled = !speaking;
    els.replay.disabled = !support.synthesis || !speaker?.hasLast() || busy;
    syncSettingsControls();
  }

  // ----------------------------------------------------------- listening
  function stopListening({ keepText = false } = {}) {
    if (!recognizer || recognizer.getState() === "idle") return;
    if (keepText) recognizer.stop(); else recognizer.abort();
  }

  function onMicClick() {
    clearError();
    notice = "";
    if (!support.recognition) {
      const msg = support.recognitionReason;
      showError(msg, true);
      toast(msg, { isError: true });
      return;
    }
    const state = recognizer.getState();
    if (state === "starting" || state === "listening") { recognizer.stop(); return; }
    if (state === "stopping") return;
    speaker?.stop(); // never record JARVIS's own voice
    recognizer.start(getInput());
  }

  // ------------------------------------------------------------ speaking
  function speakReply(text) {
    if (!speaker || !settings.get().enabled) return false;
    if (recState !== "idle") return false; // never talk over the user's recording
    clearError();
    return speaker.speak(text);
  }

  function setLastReply(text) {
    speaker?.setLast(text);
    render();
  }

  function onToggleClick() {
    if (!support.synthesis) { showError(support.synthesisReason, true); toast(support.synthesisReason, { isError: true }); return; }
    const enabled = !settings.get().enabled;
    persist({ enabled });
    if (!enabled) speaker.stop();
    toast(enabled ? "Spoken replies on" : "Spoken replies off");
  }

  function persist(patch) {
    if (!settings.set(patch)) toast("Could not save voice settings in this browser.", { isError: true });
    render();
  }

  // --------------------------------------------------------- settings sheet
  const rateText = (r) => `${r.toFixed(1)}×`;

  function fillVoices() {
    const select = els.voiceSelect;
    const voices = speaker ? speaker.getVoices() : [];
    const current = settings.get().voiceURI;
    select.replaceChildren();
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "System default";
    select.appendChild(def);
    const base = lang.split("-")[0].toLowerCase();
    const sorted = [...voices].sort((a, b) => {
      const am = a.lang?.toLowerCase().startsWith(base) ? 0 : 1;
      const bm = b.lang?.toLowerCase().startsWith(base) ? 0 : 1;
      return am - bm || a.name.localeCompare(b.name);
    });
    for (const v of sorted) {
      const o = document.createElement("option");
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})`;
      select.appendChild(o);
    }
    select.value = voices.some((v) => v.voiceURI === current) ? current : "";
    select.disabled = !support.synthesis || voices.length === 0;
    els.voiceHint.textContent = !support.synthesis ? ""
      : voices.length ? "" : "This browser lists no selectable voices. The default voice will be used.";
    els.voiceHint.hidden = !els.voiceHint.textContent;
  }

  function syncSettingsControls() {
    const cfg = settings.get();
    els.enabled.checked = cfg.enabled && support.synthesis;
    els.enabled.disabled = !support.synthesis;
    els.rate.min = String(RATE_MIN);
    els.rate.max = String(RATE_MAX);
    els.rate.value = String(cfg.rate);
    els.rate.disabled = !support.synthesis;
    els.rateValue.textContent = rateText(cfg.rate);
    els.test.disabled = !support.synthesis;
    els.inputStatus.textContent = support.recognition
      ? "Available. Tap the mic in the chat to dictate."
      : support.recognitionReason;
    els.outputStatus.textContent = support.synthesis ? "Available." : support.synthesisReason;
  }

  function openSheet() {
    stopListening();
    returnFocus = document.activeElement;
    fillVoices();
    syncSettingsControls();
    els.panel.hidden = false;
    els.closeButton.focus();
  }
  function closeSheet() {
    if (els.panel.hidden) return;
    els.panel.hidden = true;
    if (speaker && speaking && els.panel.dataset.testing === "1") speaker.stop();
    delete els.panel.dataset.testing;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  // ------------------------------------------------------------ lifecycle
  function reset() {
    stopListening();
    speaker?.stop();
    speaker?.forget();
    clearError();
    notice = "";
    closeSheet();
    render();
  }

  // ------------------------------------------------------------- listeners
  els.mic.addEventListener("click", onMicClick);
  els.toggle.addEventListener("click", onToggleClick);
  els.stop.addEventListener("click", () => { speaker?.stop(); });
  els.replay.addEventListener("click", () => {
    if (!speaker) return;
    clearError();
    if (!speaker.replay()) toast("Nothing to replay yet.");
  });
  els.openButton.addEventListener("click", openSheet);
  els.closeButton.addEventListener("click", closeSheet);

  els.enabled.addEventListener("change", () => {
    persist({ enabled: els.enabled.checked });
    if (!els.enabled.checked) speaker?.stop();
  });
  els.rate.addEventListener("input", () => {
    els.rateValue.textContent = rateText(Number(els.rate.value));
  });
  els.rate.addEventListener("change", () => persist({ rate: Number(els.rate.value) }));
  els.voiceSelect.addEventListener("change", () => persist({ voiceURI: els.voiceSelect.value }));
  els.test.addEventListener("click", () => {
    if (!speaker) return;
    clearError();
    els.panel.dataset.testing = "1";
    speaker.speak(TEST_SENTENCE, { remember: false });
  });
  win.speechSynthesis?.addEventListener?.("voiceschanged", () => { if (!els.panel.hidden) fillVoices(); });

  // Typing while dictating means "I'll take over": stop capturing, keep what is in the box.
  els.composerInput.addEventListener("input", () => stopListening());

  // Leaving the page or switching apps must release the microphone and silence speech.
  win.document.addEventListener("visibilitychange", () => {
    if (win.document.visibilityState === "hidden") stopListening({ keepText: true });
  });
  win.addEventListener("pagehide", () => { stopListening(); speaker?.stop(); });

  render();

  return {
    support,
    settings,
    speakReply,
    setLastReply,
    stopListening: () => stopListening(),
    stopSpeaking: () => speaker?.stop(),
    reset,
    isSheetOpen: () => !els.panel.hidden,
    closeSheet,
    isListening: () => recState !== "idle",
  };
}
