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

  return { addMessage, clear, setBusy, autosize, setInput, scrollToEnd };
}
