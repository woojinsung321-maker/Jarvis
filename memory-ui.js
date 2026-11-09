// The Memory Management screen: list, search, filter, add, edit, delete, clear all.
// The network functions and error wording are passed in, so this file only draws and reacts.
import { formatWhen } from "./history-ui.js";

export const CATEGORIES = [
  ["preference", "Preference"],
  ["fact", "Fact"],
  ["project", "Project"],
  ["goal", "Goal"],
  ["instruction", "Instruction"],
  ["decision", "Decision"],
];
export const categoryLabel = (value) => CATEGORIES.find(([id]) => id === value)?.[1] ?? value;

export function createMemoryUI({ els, api, dialogs, describeError, onUnauthorized, onChanged }) {
  const { panel, openButton, closeButton, search, filters, list, state, count, addButton, clearButton, editor } = els;
  let category = "";
  let total = 0;
  let loadToken = 0;
  let searchTimer = null;
  let editing = null; // memory being edited, or null when adding
  let forceReady = false;

  const isOpen = () => !panel.hidden;
  const editorOpen = () => !editor.root.hidden;

  function setState(content, kind = "") {
    state.className = `state ${kind}`.trim();
    state.replaceChildren();
    if (content) {
      if (typeof content === "string") state.textContent = content;
      else state.appendChild(content);
    }
    state.hidden = !content;
  }

  function fail(err) {
    if (err?.message === "unauthorized") { onUnauthorized(); return; }
    dialogs.toast(describeError(err), { isError: true });
  }

  // ------------------------------------------------------------ filter chips
  function buildFilters() {
    filters.replaceChildren();
    for (const [id, label] of [["", "All"], ...CATEGORIES]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter";
      button.dataset.category = id;
      button.textContent = label;
      button.setAttribute("aria-pressed", String(id === category));
      button.addEventListener("click", () => {
        category = id;
        for (const b of filters.children) b.setAttribute("aria-pressed", String(b.dataset.category === category));
        load();
      });
      filters.appendChild(button);
    }
  }

  // --------------------------------------------------------------- the list
  function card(memory) {
    const item = document.createElement("li");
    item.className = "memory-card";
    item.dataset.id = memory.id;

    const top = document.createElement("div");
    top.className = "memory-top";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = categoryLabel(memory.category);
    top.appendChild(badge);

    const text = document.createElement("p");
    text.className = "memory-text";
    text.textContent = memory.content;

    const dates = document.createElement("p");
    dates.className = "memory-dates";
    dates.textContent = `Created ${formatWhen(memory.createdAt)} · Updated ${formatWhen(memory.updatedAt)} · ${memory.source}`;

    const actions = document.createElement("div");
    actions.className = "memory-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn small";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit memory: ${memory.content.slice(0, 40)}`);
    edit.addEventListener("click", () => openEditor(memory));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn small danger";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete memory: ${memory.content.slice(0, 40)}`);
    del.addEventListener("click", () => removeOne(memory));
    actions.append(edit, del);

    item.append(top, text, dates, actions);
    return item;
  }

  async function load() {
    const token = ++loadToken;
    const q = search.value.trim();
    setState("Loading memories…");
    list.replaceChildren();
    try {
      const data = await api.listMemories({ q, category });
      if (token !== loadToken) return; // a newer search replaced this one
      const memories = data.memories ?? [];
      total = Number(data.total ?? memories.length);
      list.replaceChildren(...memories.map(card));
      const filtered = Boolean(q || category);
      count.textContent = filtered ? `${memories.length} shown · ${total} saved` : `${total} saved`;
      if (!memories.length) {
        setState(
          filtered
            ? "No memories match your search."
            : "No memories yet. Tell JARVIS “Remember that …” in chat, or tap + Add."
        );
      } else setState("");
    } catch (err) {
      if (token !== loadToken) return;
      if (err?.message === "unauthorized") { onUnauthorized(); return; }
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn small";
      retry.textContent = "Retry";
      retry.addEventListener("click", load);
      const wrap = document.createElement("div");
      const message = document.createElement("p");
      message.textContent = describeError(err);
      wrap.append(message, retry);
      count.textContent = "";
      setState(wrap, "error");
    }
  }

  async function removeOne(memory) {
    const ok = await dialogs.confirm({
      title: "Delete memory?",
      message: `“${memory.content}”\n\nJARVIS will no longer use this.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteMemory(memory.id);
      dialogs.toast("Memory deleted");
      await load();
      onChanged();
    } catch (err) {
      if (err?.message === "not_found") { await load(); return; }
      fail(err);
    }
  }

  async function clearAll() {
    if (total === 0) { dialogs.toast("There are no memories to clear."); return; }
    const ok = await dialogs.confirm({
      title: "Clear all memories?",
      message: `This permanently deletes all ${total} saved memories. Your conversations are not affected. This cannot be undone.`,
      confirmLabel: "Delete all",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.clearMemories();
      dialogs.toast("All memories cleared");
      await load();
      onChanged();
    } catch (err) {
      fail(err);
    }
  }

  // ------------------------------------------------------------ add / edit
  function updateCount() {
    editor.count.textContent = `${editor.content.value.length} / 500`;
  }

  function showEditorError(text) {
    editor.error.textContent = text;
    editor.error.hidden = !text;
  }

  function resetSimilar() {
    forceReady = false;
    editor.similar.hidden = true;
    editor.similar.replaceChildren();
    editor.force.hidden = true;
  }

  function showSimilar(items) {
    editor.similar.replaceChildren();
    const lead = document.createElement("p");
    lead.textContent = "A similar memory already exists:";
    editor.similar.appendChild(lead);
    for (const m of items) {
      const p = document.createElement("p");
      p.className = "note-text";
      p.textContent = `• ${m.content}`;
      editor.similar.appendChild(p);
    }
    editor.similar.hidden = false;
    editor.force.hidden = false;
    forceReady = true;
  }

  function openEditor(memory = null) {
    editing = memory;
    editor.title.textContent = memory ? "Edit memory" : "Add memory";
    editor.category.value = memory?.category ?? "fact";
    editor.content.value = memory?.content ?? "";
    showEditorError("");
    resetSimilar();
    updateCount();
    editor.root.hidden = false;
    editor.content.focus();
  }

  function closeEditor() {
    editor.root.hidden = true;
    editing = null;
    (panel.hidden ? openButton : addButton).focus();
  }

  async function save(force = false) {
    const content = editor.content.value.replace(/\s+/g, " ").trim();
    if (content.length < 3) { showEditorError("Write at least a few words."); return; }
    if (content.length > 500) { showEditorError("Keep it under 500 characters."); return; }
    showEditorError("");
    editor.save.disabled = true;
    editor.force.disabled = true;
    try {
      if (editing) {
        const fields = {};
        if (content !== editing.content) fields.content = content;
        if (editor.category.value !== editing.category) fields.category = editor.category.value;
        if (!Object.keys(fields).length) { closeEditor(); return; }
        await api.updateMemory(editing.id, fields);
        dialogs.toast("Memory updated");
      } else {
        await api.createMemory({ content, category: editor.category.value, source: "manual", ...(force ? { force: true } : {}) });
        dialogs.toast("Memory saved");
      }
      closeEditor();
      await load();
      onChanged();
    } catch (err) {
      if (err?.message === "unauthorized") { closeEditor(); onUnauthorized(); return; }
      if (err?.message === "similar_memory_exists") showSimilar(err.similar ?? []);
      else showEditorError(describeError(err));
    } finally {
      editor.save.disabled = false;
      editor.force.disabled = false;
    }
  }

  // -------------------------------------------------------------- open / close
  function open() {
    panel.hidden = false;
    load();
    search.focus({ preventScroll: true });
  }

  function close() {
    panel.hidden = true;
    openButton.focus();
  }

  // Wipes everything drawn (used when locking, so nothing stays visible behind the login screen).
  function reset() {
    panel.hidden = true;
    editor.root.hidden = true;
    editing = null;
    list.replaceChildren();
    search.value = "";
    category = "";
    total = 0;
    count.textContent = "";
    setState("");
    buildFilters();
    loadToken++;
  }

  // ------------------------------------------------------------------- wiring
  for (const [id, label] of CATEGORIES) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    editor.category.appendChild(option);
  }
  buildFilters();
  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  addButton.addEventListener("click", () => openEditor(null));
  clearButton.addEventListener("click", clearAll);
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 250);
  });
  editor.content.addEventListener("input", () => { updateCount(); resetSimilar(); });
  editor.form.addEventListener("submit", (event) => { event.preventDefault(); save(false); });
  editor.force.addEventListener("click", () => { if (forceReady) save(true); });
  editor.cancel.addEventListener("click", closeEditor);
  editor.root.addEventListener("click", (event) => { if (event.target === editor.root) closeEditor(); });

  return { open, close, isOpen, editorOpen, closeEditor, reset, reload: load };
}
