// Everything that draws on the screen for the chat. No network code here.

export function createChatUI({ messages, input, send }) {
  function scrollToEnd() {
    messages.scrollTop = messages.scrollHeight;
  }

  // Uses textContent only, so text is never interpreted as HTML (prevents injection).
  function addMessage(role, text, extraClass = "") {
    const el = document.createElement("div");
    el.className = `msg ${role} ${extraClass}`.trim();
    el.textContent = text;
    messages.appendChild(el);
    scrollToEnd();
    return el;
  }

  // A small status card under the replies (memory feedback). textContent only.
  // actions: [{ label, run }]. While one runs, all of that note's buttons are disabled.
  function addNote({ kind = "info", label, text = "", actions = [], details = null }) {
    const el = document.createElement("div");
    el.className = `note ${kind}`.trim();
    const labelEl = document.createElement("span");
    labelEl.className = "note-label";
    const textEl = document.createElement("span");
    textEl.className = "note-text";
    el.append(labelEl, textEl);

    if (details) {
      const box = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = details.summary;
      const ul = document.createElement("ul");
      for (const line of details.items) {
        const li = document.createElement("li");
        li.textContent = line;
        ul.appendChild(li);
      }
      box.append(summary, ul);
      el.appendChild(box);
    }

    const bar = document.createElement("div");
    bar.className = "note-actions";
    const buttons = actions.map(({ label: name, run }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn small";
      b.textContent = name;
      b.addEventListener("click", async () => {
        buttons.forEach((x) => { x.disabled = true; });
        try { await run(handle); } finally { buttons.forEach((x) => { x.disabled = false; }); }
      });
      bar.appendChild(b);
      return b;
    });
    if (buttons.length) el.appendChild(bar);

    const handle = {
      el,
      update({ kind: k, label: l, text: t }) {
        if (k !== undefined) el.className = `note ${k}`.trim();
        if (l !== undefined) labelEl.textContent = l;
        if (t !== undefined) textEl.textContent = t;
      },
      clearActions() { bar.remove(); },
      remove() { el.remove(); },
    };
    handle.update({ label, text });
    messages.appendChild(el);
    scrollToEnd();
    return handle;
  }

  function clear() {
    messages.replaceChildren();
  }

  function setBusy(value) {
    send.disabled = value;
    messages.setAttribute("aria-busy", String(value));
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  function setInput(text) {
    input.value = text;
    autosize();
  }

  return { addMessage, addNote, clear, setBusy, autosize, setInput, scrollToEnd };
}
