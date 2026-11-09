// Login screen helper. Only touches the screen; the network calls live in backend.js.

export function createAuthUI({ input, button, error }) {
  return {
    focus: () => input.focus(),
    value: () => input.value,
    clear: () => { input.value = ""; },
    setBusy(busy) {
      button.disabled = busy;
      input.disabled = busy;
    },
    showError(text) {
      error.textContent = text;
      error.hidden = false;
    },
    hideError() {
      error.textContent = "";
      error.hidden = true;
    },
  };
}
