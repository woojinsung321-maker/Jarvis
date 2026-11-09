// The conversation-history drawer. Draws the list and reports taps; the network code lives in app.js/backend.js.

export function formatWhen(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return `${d.toLocaleDateString([], opts)} ${time}`;
}

function iconButton(className, label, pathD) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `row-btn ${className}`;
  button.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  button.appendChild(svg);
  return button;
}

export function createHistoryUI({ drawer, backdrop, openButton, closeButton, newButton, list, state, onOpenDrawer, onOpenConversation, onRename, onDelete, onNew }) {
  let activeId = null;

  const isOpen = () => !drawer.hidden;

  function open() {
    drawer.hidden = false;
    backdrop.hidden = false;
    openButton.setAttribute("aria-expanded", "true");
    onOpenDrawer();
    drawer.querySelector(".conv-open, #drawer-new")?.focus();
  }

  function close() {
    drawer.hidden = true;
    backdrop.hidden = true;
    openButton.setAttribute("aria-expanded", "false");
  }

  function setState(text, kind = "") {
    state.textContent = text;
    state.className = `state ${kind}`.trim();
    state.hidden = !text;
  }

  function render(conversations) {
    list.replaceChildren();
    if (!conversations.length) return;
    for (const conv of conversations) {
      const item = document.createElement("li");
      item.className = "conv-item";
      item.dataset.id = conv.id;
      if (conv.id === activeId) item.classList.add("active");

      const open = document.createElement("button");
      open.type = "button";
      open.className = "conv-open";
      const title = document.createElement("span");
      title.className = "conv-title";
      title.textContent = conv.title;
      const date = document.createElement("span");
      date.className = "conv-date";
      date.textContent = formatWhen(conv.updatedAt);
      open.append(title, date);
      open.addEventListener("click", () => onOpenConversation(conv.id));

      const rename = iconButton("rename", `Rename ${conv.title}`, "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4");
      rename.addEventListener("click", () => onRename(conv));
      const del = iconButton("delete", `Delete ${conv.title}`, "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6");
      del.addEventListener("click", () => onDelete(conv));

      item.append(open, rename, del);
      list.appendChild(item);
    }
  }

  function setActive(id) {
    activeId = id;
    for (const item of list.children) item.classList.toggle("active", item.dataset.id === id);
  }

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  newButton.addEventListener("click", () => { close(); onNew(); });

  return { open, close, isOpen, render, setState, setActive };
}
