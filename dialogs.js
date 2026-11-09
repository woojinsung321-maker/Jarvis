// Confirm / text-prompt dialog and toast messages. Only touches the screen; text is set with
// textContent so nothing typed or received is ever interpreted as HTML.

export function createDialogs({ dialog, title, message, input, error, cancel, ok, toast }) {
  let finish = null;
  let returnFocus = null;
  let toastTimer = null;

  const isOpen = () => !dialog.hidden;

  function close(result) {
    dialog.hidden = true;
    input.hidden = true;
    error.hidden = true;
    ok.classList.remove("danger", "solid");
    const done = finish;
    finish = null;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
    if (done) done(result);
  }

  // Resolves { ok: true, value } or { ok: false }.
  function ask({ title: heading, message: body = "", confirmLabel = "OK", cancelLabel = "Cancel", danger = false, input: field = null, validate = null }) {
    if (finish) close({ ok: false }); // never stack two dialogs
    return new Promise((resolve) => {
      finish = resolve;
      returnFocus = document.activeElement;
      title.textContent = heading;
      message.textContent = body;
      message.hidden = !body;
      ok.textContent = confirmLabel;
      cancel.textContent = cancelLabel;
      ok.classList.toggle("danger", danger);
      ok.classList.toggle("solid", danger);
      ok.classList.toggle("primary", !danger);
      error.hidden = true;
      input.hidden = !field;
      if (field) {
        input.value = field.value ?? "";
        input.maxLength = field.maxLength ?? 80;
        input.placeholder = field.placeholder ?? "";
      }
      dialog.hidden = false;
      // Destructive dialogs focus Cancel so a stray tap cannot confirm.
      (field ? input : danger ? cancel : ok).focus();
      if (field) input.select();

      dialog.onkeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close({ ok: false });
        } else if (event.key === "Enter" && event.target === input) {
          event.preventDefault();
          ok.click();
        } else if (event.key === "Tab") {
          const items = [input, cancel, ok].filter((el) => !el.hidden);
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
      cancel.onclick = () => close({ ok: false });
      dialog.onclick = (event) => { if (event.target === dialog) close({ ok: false }); };
      ok.onclick = () => {
        const value = input.value;
        const problem = field && validate ? validate(value) : "";
        if (problem) {
          error.textContent = problem;
          error.hidden = false;
          input.focus();
          return;
        }
        close({ ok: true, value });
      };
    });
  }

  const confirm = (options) => ask(options).then((r) => r.ok);

  function showToast(text, { isError = false } = {}) {
    toast.textContent = text;
    toast.classList.toggle("error", isError);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 5000 : 3000);
  }

  return { ask, confirm, toast: showToast, isOpen, cancelAll: () => { if (finish) close({ ok: false }); } };
}
