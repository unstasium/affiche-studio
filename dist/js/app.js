import { setLanguage, t, applyStatic, getLanguage } from "./i18n.js";
import { Editor } from "./editor.js";
import { documentToHtml, templateThumb, normalizeLayer, FONTS } from "./render.js";
import { icon, paintIcons } from "./icons.js";
import { TEMPLATES, PALETTE_PRESETS, buildTemplate } from "./templates.js";

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ACCENTS = ["#7c3aed", "#cd4c51", "#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#f3f3fc"];

const FORMATS = [
  { id: "story", group: "social", key: "formatStory", w: 1080, h: 1920 },
  { id: "square", group: "social", key: "formatSquare", w: 1080, h: 1080 },
  { id: "portrait", group: "social", key: "formatPortrait", w: 1080, h: 1350 },
  { id: "landscape", group: "social", key: "formatLandscape", w: 1920, h: 1080 },
  { id: "a5", group: "print", key: "formatA5", w: 1748, h: 2480 },
  { id: "a4", group: "print", key: "formatA4", w: 2480, h: 3508 },
  { id: "a3", group: "print", key: "formatA3", w: 3508, h: 4961 },
  { id: "a2", group: "print", key: "formatA2", w: 4961, h: 7016 },
  { id: "linkedin", group: "web", key: "formatLinkedin", w: 1200, h: 627 },
  { id: "x", group: "web", key: "formatX", w: 1600, h: 900 },
  { id: "youtube", group: "web", key: "formatYoutube", w: 1280, h: 720 },
  { id: "custom", group: "custom", key: "custom", w: 1080, h: 1350 },
];

const state = {
  settings: null,
  env: null,
  projects: [],
  project: null,
  document: null,
  assets: [],
  chat: [],
  selection: [],
  editor: null,
  lang: "fr",
  theme: "dark",
  accent: "#7c3aed",
  generating: false,
  dirty: false,
  saveTimer: null,
  versionTimer: null,
  selectedFormat: "story",
  selectedPalette: PALETTE_PRESETS[1].colors,
  projectLang: "fr",
  pendingTemplate: null,
  toastPath: null,
  toastTimer: null,
  paletteIndex: 0,
  paletteCommands: [],
  update: null,
  clipboard: [],
};

function uid() {
  if (crypto.randomUUID) return `layer-${crypto.randomUUID()}`;
  return `layer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  loadPreferences();
  await setLanguage(state.lang);
  applyPreferences();
  bindEvents();
  buildEditor();

  try {
    state.settings = await invoke("get_settings");
    state.env = await invoke("environment");
    state.projects = await invoke("list_projects");
  } catch (error) {
    toast(String(error), true);
  }

  if (state.env?.devTheme) state.theme = state.env.devTheme;
  if (state.env?.devLang) {
    state.lang = state.env.devLang;
    await setLanguage(state.lang);
  }
  applyPreferences();
  renderAll();
  if (state.env?.devOpen === "help") {
    openModal("modal-help");
  } else if (state.env?.devOpen === "account") {
    openAccount();
  } else if (state.env?.devOpen === "layers") {
    await openProject("demo-v21");
    switchTab("layers");
  } else if (state.env?.devOpen === "inspector") {
    await openProject("demo-v21");
    state.editor.select(["t1"]);
    switchTab("style");
  } else if (state.env?.devOpen === "templates") {
    openTemplates();
  } else if (state.env?.devOpen === "palette") {
    openPalette();
  } else if (state.env?.devOpen === "typing") {
    await openProject("demo-v21");
    showTyping();
  } else if (state.env?.devOpen) {
    await openProject(state.env.devOpen);
  } else if (!state.settings?.hasKey && (state.settings?.backend || "api") === "api") {
    openSettings();
  }

  if (listen) {
    await listen("gen-chunk", (event) => updateLive(String(event.payload?.text || "").length));
    await listen("gen-stage", () => {
      if (state.generating && !$("#typing-row")) showTyping();
    });
    await listen("gen-chunk", (event) => {
      if (state.generating) {
        state.genChars = (state.genChars || 0) + String(event.payload?.text || "").length;
        updateTypingStatus(state.genChars);
      }
    });
    await listen("update-progress", (event) => {
      const { chunk, total } = event.payload || {};
      const status = $("#update-status");
      if (!status) return;
      if (total) {
        status.textContent = `${t("updateStarted")} ${Math.round((chunk / total) * 100)}%`;
      } else {
        status.textContent = t("updateStarted");
      }
    });
  }

  setTimeout(() => checkUpdates(true), 3000);
}

function loadPreferences() {
  const systemLang = (navigator.language || "fr").slice(0, 2);
  state.lang = localStorage.getItem("as.lang") || (["fr", "en", "es"].includes(systemLang) ? systemLang : "fr");
  state.theme = localStorage.getItem("as.theme") || "dark";
  state.accent = localStorage.getItem("as.accent") || "#7c3aed";
  state.projectLang = state.lang;
}

function applyPreferences() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.setProperty("--accent", state.accent);
}

function buildEditor() {
  state.editor = new Editor({
    shell: $("#canvas-shell"),
    canvas: $("#canvas"),
    overlay: $("#overlay"),
    guides: $("#guides"),
    onChange: () => {
      state.document = state.editor.doc;
      markDirty();
      renderLayers();
    },
    onSelection: (ids) => {
      state.selection = ids;
      renderLayers();
      renderStyle();
      renderChatSelection();
    },
    onZoom: (scale) => {
      $("#zoom-label").textContent = `${Math.round(scale * 100)}%`;
    },
  });
  const stage = $("#stage");
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (state.editor?.doc && !state.zoomed) state.editor.fit();
    }).observe(stage);
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderAll() {
  applyStatic();
  renderEmptyKbd();
  renderProjects();
  renderApiStatus();
  renderVersion();
  renderSuggestions();
  renderChat();
  renderLayers();
  renderStyle();
  renderAssets();
  renderChatSelection();
  paintIcons();
  autoGrow();
}

function renderEmptyKbd() {
  $("#empty-kbd").innerHTML = `${t("emptyKbd").replace("Ctrl/Cmd + K", "<kbd>Ctrl/Cmd + K</kbd>")}`;
}

function renderVersion() {
  const version = state.env?.version ? `v${state.env.version}` : "v2.0.0";
  $("#version-label").textContent = version;
  const accountVersion = $("#account-version");
  if (accountVersion) accountVersion.textContent = version;
}

function renderProjects() {
  const list = $("#project-list");
  list.innerHTML = "";
  const query = ($("#project-search").value || "").trim().toLowerCase();
  const projects = state.projects.filter((project) => project.name.toLowerCase().includes(query));
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "projects-empty";
    empty.textContent = t("noProjects");
    list.appendChild(empty);
    return;
  }
  let index = 0;
  for (const project of projects) {
    const item = document.createElement("button");
    item.style.animationDelay = `${Math.min(index++, 14) * 18}ms`;
    item.className = "project-item" + (state.project?.id === project.id ? " active" : "");
    const name = document.createElement("span");
    name.className = "pi-name";
    name.textContent = project.name;
    const meta = document.createElement("span");
    meta.className = "pi-meta";
    meta.textContent = formatLabel(project.width, project.height) + " · " + project.language.toUpperCase();
    item.append(name, meta);
    item.addEventListener("click", () => openProject(project.id));
    list.appendChild(item);
  }
}

function renderApiStatus() {
  const backend = state.settings?.backend || "api";
  if (backend === "opencode") {
    const ok = Boolean(state.env?.opencode);
    $("#api-dot").classList.toggle("ok", ok);
    $("#api-label").textContent = ok
      ? `OpenCode · ${state.settings.model}`
      : t("opencodeMissing");
    return;
  }
  const ok = Boolean(state.settings?.hasKey);
  $("#api-dot").classList.toggle("ok", ok);
  $("#api-label").textContent = ok ? state.settings.model || t("apiConfigured") : t("apiNotConfigured");
}

function formatLabel(width, height) {
  const match = FORMATS.find((format) => format.w === width && format.h === height);
  return match ? `${t(match.key)} · ${width}×${height}` : `${width} × ${height}`;
}

function renderChat() {
  const messages = $("#chat-messages");
  messages.innerHTML = "";
  $("#chat-empty").hidden = state.chat.length > 0;
  for (const message of state.chat) {
    const row = document.createElement("div");
    row.className = `msg-row ${message.role}${message.error ? " error" : ""}`;
    const content = document.createElement("div");
    content.className = "msg-content";

    if (message.role !== "system") {
      const avatar = document.createElement("div");
      avatar.className = "msg-avatar";
      avatar.innerHTML = icon(message.role === "user" ? "account" : "sparkles", 14);
      row.appendChild(avatar);

      const head = document.createElement("div");
      head.className = "msg-head";
      const who = document.createElement("span");
      who.textContent = message.role === "user" ? t("chatYou") : t("chatAi");
      const time = document.createElement("span");
      time.textContent = formatTime(message.at);
      head.append(who, time);
      content.appendChild(head);
    }

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.innerHTML = renderChatText(message.content);
    content.appendChild(bubble);

    if (message.role !== "system") {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      const copy = document.createElement("button");
      copy.className = "msg-action";
      copy.title = t("copy");
      copy.innerHTML = icon("copy", 13);
      copy.addEventListener("click", () => copyText(message.content));
      actions.appendChild(copy);
      if (message.role === "user" || message.error) {
        const retry = document.createElement("button");
        retry.className = "msg-action";
        retry.title = t("retry");
        retry.innerHTML = icon("refresh", 13);
        retry.addEventListener("click", retryLast);
        actions.appendChild(retry);
      }
      content.appendChild(actions);
    }

    row.appendChild(content);
    messages.appendChild(row);
  }
  paintIcons(messages);
  scrollChat(state.chat.length > 0);
}

function renderChatText(value) {
  return escapeHtml(String(value || ""))
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t("copied"));
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast(t("copied"));
  }
}

function renderSuggestions() {
  const box = $("#chat-suggestions");
  if (!box) return;
  box.innerHTML = "";
  const items = [
    { key: "suggest1", icon: "sparkles" },
    { key: "suggest2", icon: "templates" },
    { key: "suggest3", icon: "text" },
  ];
  for (const item of items) {
    const button = document.createElement("button");
    button.className = "suggestion";
    button.innerHTML = `${icon(item.icon, 14)}<span>${escapeHtml(t(item.key))}</span>`;
    button.addEventListener("click", () => {
      $("#chat-input").value = t(item.key);
      autoGrow();
      $("#chat-input").focus();
    });
    box.appendChild(button);
  }
}

function scrollChat(force = false) {
  const scroll = $("#chat-scroll");
  if (!scroll) return;
  const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 140;
  if (force || nearBottom) scroll.scrollTop = scroll.scrollHeight;
  updateScrollButton();
}

function updateScrollButton() {
  const scroll = $("#chat-scroll");
  const button = $("#scroll-bottom");
  if (!scroll || !button) return;
  button.hidden = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90;
}

function autoGrow() {
  const input = $("#chat-input");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(150, input.scrollHeight)}px`;
}

function renderChatSelection() {
  const box = $("#chat-selection");
  if (!state.selection.length) {
    box.hidden = true;
    return;
  }
  const layers = state.selection
    .map((id) => state.document?.layers.find((layer) => layer.id === id))
    .filter(Boolean);
  if (!layers.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.textContent = `${t("layers")} : ${layers.map((l) => l.name).join(", ")}`;
}

function renderLayers() {
  const list = $("#layers-list");
  if (!state.document) return;
  list.innerHTML = "";
  const layers = [...state.document.layers].reverse();
  for (const layer of layers) {
    const row = document.createElement("div");
    row.className =
      "layer-row" +
      (state.selection.includes(layer.id) ? " active" : "") +
      (layer.groupId ? " grouped" : "");
    row.dataset.id = layer.id;
    row.draggable = true;

    const type = document.createElement("span");
    type.className = "layer-type";
    type.innerHTML = icon(layer.type === "text" ? "text" : layer.type === "image" ? "image" : "shape", 13);

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name;

    const actions = document.createElement("span");
    actions.className = "layer-actions";
    const eye = document.createElement("button");
    eye.innerHTML = icon(layer.hidden ? "eyeOff" : "eye", 12);
    eye.title = layer.hidden ? t("show") : t("hide");
    eye.addEventListener("click", (event) => {
      event.stopPropagation();
      state.editor.updateLayer(layer.id, { hidden: !layer.hidden });
    });
    const lock = document.createElement("button");
    lock.innerHTML = icon(layer.locked ? "lock" : "unlock", 12);
    lock.title = layer.locked ? t("unlock") : t("lock");
    lock.addEventListener("click", (event) => {
      event.stopPropagation();
      state.editor.updateLayer(layer.id, { locked: !layer.locked });
    });
    actions.append(eye, lock);

    row.append(type, name, actions);
    row.addEventListener("click", () => state.editor.select([layer.id]));
    row.addEventListener("dblclick", () => {
      const value = prompt(t("projectName"), layer.name);
      if (value) state.editor.updateLayer(layer.id, { name: value });
    });
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", layer.id);
    });
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const dragged = event.dataTransfer.getData("text/plain");
      if (dragged && dragged !== layer.id) reorderLayer(dragged, layer.id);
    });
    list.appendChild(row);
  }
}

function reorderLayer(draggedId, targetId) {
  const layers = state.document.layers;
  const from = layers.findIndex((layer) => layer.id === draggedId);
  const to = layers.findIndex((layer) => layer.id === targetId);
  if (from < 0 || to < 0) return;
  state.editor.pushHistory();
  const [layer] = layers.splice(from, 1);
  layers.splice(to, 0, layer);
  state.editor.render();
  state.editor.onChange();
}

function renderAssets() {
  const strip = $("#panel-assets");
  strip.innerHTML = "";
  if (!state.assets.length) {
    const empty = document.createElement("span");
    empty.className = "assets-empty";
    empty.textContent = t("noAssets");
    strip.appendChild(empty);
    return;
  }
  for (const asset of state.assets) {
    const thumb = document.createElement("button");
    thumb.className = "asset-thumb";
    thumb.style.backgroundImage = `url("${asset.dataUrl}")`;
    thumb.title = asset.name;
    thumb.addEventListener("click", () => addImageLayer(asset.name));
    strip.appendChild(thumb);
  }
}

/* ------------------------------------------------------------------ */
/* Style panel                                                         */
/* ------------------------------------------------------------------ */

function control(label, input) {
  const wrap = document.createElement("label");
  wrap.className = "control";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.append(span, input);
  return wrap;
}

function numberInput(value, onChange, options = {}) {
  const input = document.createElement("input");
  input.type = "number";
  input.value = Math.round(value);
  if (options.min !== undefined) input.min = options.min;
  if (options.max !== undefined) input.max = options.max;
  if (options.step !== undefined) input.step = options.step;
  input.addEventListener("change", () => onChange(Number(input.value)));
  return input;
}

function colorInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

function segmented(values, current, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "seg-row";
  for (const value of values) {
    const button = document.createElement("button");
    button.type = "button";
    if (value.icon) button.innerHTML = icon(value.icon, 14);
    else button.textContent = value.label;
    if (value.title) button.title = value.title;
    button.classList.toggle("active", value.id === current);
    button.addEventListener("click", () => onChange(value.id));
    wrap.appendChild(button);
  }
  return wrap;
}

function section(title, children) {
  const wrap = document.createElement("div");
  wrap.className = "style-section";
  const h = document.createElement("h3");
  h.textContent = title;
  wrap.appendChild(h);
  for (const child of children) if (child) wrap.appendChild(child);
  return wrap;
}

function alignSelection(mode) {
  const layers = state.selection
    .map((id) => state.document.layers.find((layer) => layer.id === id))
    .filter((layer) => layer && !layer.locked);
  if (layers.length < 2) return;
  const minX = Math.min(...layers.map((layer) => layer.x));
  const maxX = Math.max(...layers.map((layer) => layer.x + layer.w));
  const minY = Math.min(...layers.map((layer) => layer.y));
  const maxY = Math.max(...layers.map((layer) => layer.y + layer.h));
  state.editor.pushHistory();
  for (const layer of layers) {
    if (mode === "left") layer.x = minX;
    if (mode === "centerH") layer.x = (minX + maxX) / 2 - layer.w / 2;
    if (mode === "right") layer.x = maxX - layer.w;
    if (mode === "top") layer.y = minY;
    if (mode === "middleV") layer.y = (minY + maxY) / 2 - layer.h / 2;
    if (mode === "bottom") layer.y = maxY - layer.h;
    layer.x = Math.round(layer.x);
    layer.y = Math.round(layer.y);
  }
  state.editor.render();
  state.editor.onChange();
}

function renderStyle() {
  const panel = $("#style-panel");
  panel.innerHTML = "";
  if (!state.document) return;
  const layers = state.selection
    .map((id) => state.document.layers.find((layer) => layer.id === id))
    .filter(Boolean);

  if (layers.length > 1) {
    const alignGrid = document.createElement("div");
    alignGrid.className = "grid-3";
    const modes = [
      ["left", "alignLeft", "left"],
      ["centerH", "alignCenter", "center"],
      ["right", "alignRight", "right"],
      ["top", "alignTop", "top"],
      ["middleV", "alignMiddle", "middle"],
      ["bottom", "alignBottom", "bottom"],
    ];
    for (const [mode, iconName, label] of modes) {
      const button = document.createElement("button");
      button.className = "btn btn-mini";
      button.title = t(label);
      button.innerHTML = icon(iconName, 14);
      button.addEventListener("click", () => alignSelection(mode));
      alignGrid.appendChild(button);
    }
    panel.appendChild(section(t("align"), [alignGrid]));
  }

  if (layers.length !== 1) {
    const grid = document.createElement("div");
    grid.className = "grid-2";
    grid.append(
      control(t("background"), colorInput(state.document.background, (value) => {
        state.editor.updateDocument({ background: value });
      }))
    );
    const palette = document.createElement("div");
    palette.className = "palette-row";
    for (const color of state.document.palette || []) {
      const dot = document.createElement("button");
      dot.className = "accent-dot";
      dot.style.background = color;
      dot.style.width = "26px";
      dot.style.height = "26px";
      dot.title = color;
      dot.addEventListener("click", () => state.editor.updateDocument({ background: color }));
      palette.appendChild(dot);
    }
    panel.append(section(t("canvas"), [grid, palette]));
    const empty = document.createElement("div");
    empty.className = "empty-style";
    empty.textContent = t("noSelection");
    panel.appendChild(empty);
    return;
  }

  const layer = layers[0];
  const update = (patch) => state.editor.updateLayer(layer.id, patch);

  panel.appendChild(
    section(t("layerName"), [
      (() => {
        const input = document.createElement("input");
        input.type = "text";
        input.value = layer.name;
        input.addEventListener("change", () => update({ name: input.value }));
        return control(t("layerNameLabel"), input);
      })(),
    ])
  );

  const geometry = document.createElement("div");
  geometry.className = "grid-2";
  geometry.append(
    control("X", numberInput(layer.x, (value) => update({ x: value }))),
    control("Y", numberInput(layer.y, (value) => update({ y: value }))),
    control(t("width"), numberInput(layer.w, (value) => update({ w: value }), { min: 8 })),
    control(t("height"), numberInput(layer.h, (value) => update({ h: value }), { min: 8 })),
    control(t("rotation"), numberInput(layer.rotation, (value) => update({ rotation: value }))),
    control(t("opacity"), numberInput(Math.round((layer.opacity ?? 1) * 100), (value) => update({ opacity: value / 100 }), { min: 0, max: 100 }))
  );
  panel.appendChild(section(t("position"), [geometry]));

  if (layer.type === "text") {
    const font = document.createElement("select");
    for (const entry of FONTS) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.label;
      font.appendChild(option);
    }
    font.value = layer.style.fontFamily;
    font.addEventListener("change", () => update({ style: { fontFamily: font.value } }));

    const text = document.createElement("textarea");
    text.value = layer.text;
    text.rows = 3;
    text.style.minHeight = "70px";
    text.addEventListener("change", () => update({ text: text.value }));

    const grid = document.createElement("div");
    grid.className = "grid-2";
    grid.append(
      control(t("font"), font),
      control(t("fontSize"), numberInput(layer.style.fontSize, (value) => update({ style: { fontSize: value } }), { min: 4 })),
      control(t("weight"), numberInput(layer.style.fontWeight, (value) => update({ style: { fontWeight: value } }), { min: 100, max: 900, step: 100 })),
      control(t("lineHeight"), numberInput(layer.style.lineHeight, (value) => update({ style: { lineHeight: value } }), { step: 0.05 })),
      control(t("letterSpacing"), numberInput(layer.style.letterSpacing, (value) => update({ style: { letterSpacing: value } }))),
      control(t("color"), colorInput(layer.style.color, (value) => update({ style: { color: value } })))
    );

    const align = segmented(
      [
        { id: "left", icon: "alignLeft", title: t("left") },
        { id: "center", icon: "alignCenter", title: t("center") },
        { id: "right", icon: "alignRight", title: t("right") },
        { id: "justify", icon: "alignJustify", title: t("justify") },
      ],
      layer.style.align,
      (value) => update({ style: { align: value } })
    );
    const valign = segmented(
      [
        { id: "top", icon: "alignTop", title: t("top") },
        { id: "middle", icon: "alignMiddle", title: t("middle") },
        { id: "bottom", icon: "alignBottom", title: t("bottom") },
      ],
      layer.style.valign,
      (value) => update({ style: { valign: value } })
    );
    const transform = segmented(
      [
        { id: "none", label: "Aa" },
        { id: "uppercase", label: "AA" },
        { id: "lowercase", label: "aa" },
      ],
      layer.style.textTransform,
      (value) => update({ style: { textTransform: value } })
    );

    panel.append(
      section(t("typography"), [text, grid, align, valign, transform])
    );
  }

  if (layer.type === "image") {
    const select = document.createElement("select");
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = t("noAssets");
    select.appendChild(empty);
    for (const asset of state.assets) {
      const option = document.createElement("option");
      option.value = asset.name;
      option.textContent = asset.name;
      select.appendChild(option);
    }
    select.value = layer.src;
    select.addEventListener("change", () => update({ src: select.value }));

    const fit = segmented(
      [
        { id: "contain", label: t("contain") },
        { id: "cover", label: t("cover") },
      ],
      layer.fit,
      (value) => update({ fit: value })
    );

    panel.append(
      section(t("image"), [
        control(t("source"), select),
        fit,
        control(t("radius"), numberInput(layer.radius, (value) => update({ radius: value }), { min: 0 })),
      ])
    );
  }

  if (layer.type === "shape") {
    const shape = segmented(
      [
        { id: "rect", label: t("rectangle") },
        { id: "ellipse", label: t("ellipse") },
        { id: "line", label: t("line") },
      ],
      layer.shape,
      (value) => update({ shape: value })
    );
    const stroke = document.createElement("input");
    stroke.type = "color";
    stroke.value = /^#[0-9a-f]{6}$/i.test(layer.stroke) ? layer.stroke : "#000000";
    stroke.addEventListener("input", () => update({ stroke: stroke.value }));

    const grid = document.createElement("div");
    grid.className = "grid-2";
    grid.append(
      control(t("fill"), colorInput(layer.fill, (value) => update({ fill: value }))),
      control(t("stroke"), stroke),
      control(t("strokeWidth"), numberInput(layer.strokeWidth, (value) => update({ strokeWidth: value }), { min: 0 })),
      control(t("radius"), numberInput(layer.radius, (value) => update({ radius: value }), { min: 0 }))
    );

    panel.append(section(t("shape"), [shape, grid]));
  }

  const arrange = document.createElement("div");
  arrange.className = "grid-2";
  const forward = document.createElement("button");
  forward.className = "btn btn-mini";
  forward.innerHTML = `${icon("arrowUp", 13)} ${t("bringForward")}`;
  forward.addEventListener("click", () => state.editor.bringForward());
  const backward = document.createElement("button");
  backward.className = "btn btn-mini";
  backward.innerHTML = `${icon("arrowDown", 13)} ${t("sendBackward")}`;
  backward.addEventListener("click", () => state.editor.sendBackward());
  const dup = document.createElement("button");
  dup.className = "btn btn-mini";
  dup.innerHTML = `${icon("copy", 13)} ${t("duplicate")}`;
  dup.addEventListener("click", () => state.editor.duplicateSelection());
  const del = document.createElement("button");
  del.className = "btn btn-mini danger";
  del.innerHTML = `${icon("trash", 13)} ${t("delete")}`;
  del.addEventListener("click", () => state.editor.deleteSelection());
  arrange.append(forward, backward, dup, del);
  panel.appendChild(section(t("arrange"), [arrange]));
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

async function openProject(id) {
  try {
    const project = await invoke("open_project", { projectId: id });
    state.project = project;
    state.document = project.document;
    state.assets = project.assets;
    state.chat = project.chat || [];
    state.selection = [];
    state.zoomed = false;

    $("#empty-state").hidden = true;
    $("#workspace").hidden = false;
    $("#app").classList.remove("no-project");
    $("#project-name").textContent = project.name;
    $("#project-format").textContent = `${project.width} × ${project.height}`;
    $("#status-size").textContent = `${project.width} × ${project.height} px`;

    state.editor.setAssets(project.assets);
    state.editor.setDocument(project.document, { reset: true });
    renderProjects();
    renderChat();
    renderLayers();
    renderStyle();
    renderAssets();
    renderChatSelection();
    setSaveState("saved");
    state.dirty = false;
    startVersionTimer();
  } catch (error) {
    toast(String(error), true);
  }
}

async function createProject({ name, width, height, language, palette, template, open = true }) {
  const project = await invoke("create_project", {
    name,
    width,
    height,
    language,
    palette,
  });
  if (template) {
    const document = buildTemplate(template, language, palette);
    document.width = width;
    document.height = height;
    await invoke("save_document", { projectId: project.id, document });
    await invoke("save_version", { projectId: project.id });
  }
  state.projects = await invoke("list_projects");
  if (open) await openProject(project.id);
  return project;
}

async function openNewProject() {
  $("#project-form").reset();
  state.selectedFormat = "story";
  state.selectedPalette = PALETTE_PRESETS[1].colors;
  state.projectLang = state.lang;
  $("#proj-name").value = "";
  $("#custom-size").hidden = true;
  renderFormatGroups();
  const applyProjectPalette = (colors) => {
    state.selectedPalette = colors;
    renderPaletteRow($("#project-palettes"), colors, applyProjectPalette);
  };
  renderPaletteRow($("#project-palettes"), state.selectedPalette, applyProjectPalette);
  const applyProjectLanguage = (value) => {
    state.projectLang = value;
    renderSegmented($("#project-language"), "lang", value, applyProjectLanguage);
  };
  renderSegmented($("#project-language"), "lang", state.projectLang, applyProjectLanguage);
  openModal("modal-project");
  setTimeout(() => $("#proj-name").focus(), 60);
}

function renderFormatGroups() {
  const container = $("#format-groups");
  container.innerHTML = "";
  const groups = ["social", "print", "web", "custom"];
  for (const group of groups) {
    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "format-group-title";
    title.textContent = t(`format${group.charAt(0).toUpperCase()}${group.slice(1)}`);
    wrap.appendChild(title);
    const grid = document.createElement("div");
    grid.className = "format-grid";
    for (const format of FORMATS.filter((value) => value.group === group)) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "format-card" + (state.selectedFormat === format.id ? " active" : "");
      card.dataset.format = format.id;
      const ratio = document.createElement("div");
      ratio.className = "format-ratio";
      const box = document.createElement("i");
      const scale = 34 / Math.max(format.w, format.h);
      box.style.width = `${Math.max(8, format.w * scale)}px`;
      box.style.height = `${Math.max(8, format.h * scale)}px`;
      ratio.appendChild(box);
      const name = document.createElement("div");
      name.className = "format-name";
      name.textContent = t(format.key);
      const size = document.createElement("div");
      size.className = "format-size";
      size.textContent = format.id === "custom" ? t("custom") : `${format.w} × ${format.h}`;
      card.append(ratio, name, size);
      card.addEventListener("click", () => {
        state.selectedFormat = format.id;
        renderFormatGroups();
        $("#custom-size").hidden = format.id !== "custom";
      });
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    container.appendChild(wrap);
  }
}

function renderPaletteRow(container, active, onChange) {
  container.innerHTML = "";
  for (const preset of PALETTE_PRESETS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "palette-swatch" + (preset.colors.join() === active.join() ? " active" : "");
    swatch.title = preset.id;
    for (const color of preset.colors) {
      const span = document.createElement("span");
      span.style.background = color;
      swatch.appendChild(span);
    }
    swatch.addEventListener("click", () => onChange(preset.colors));
    container.appendChild(swatch);
  }
}

function renderSegmented(container, attr, active, onChange) {
  container.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset[attr] === active);
    button.onclick = () => onChange(button.dataset[attr]);
  });
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

function openTemplates() {
  const grid = $("#template-grid");
  grid.innerHTML = "";
  const palette = PALETTE_PRESETS[1].colors;
  for (const template of TEMPLATES) {
    const templateDoc = buildTemplate(template.id, state.lang, palette);
    templateDoc.width = 1080;
    templateDoc.height = 1920;
    const card = document.createElement("button");
    card.className = "template-card";
    const thumb = document.createElement("div");
    thumb.className = "template-thumb";
    thumb.appendChild(templateThumb(templateDoc, []));
    const info = document.createElement("div");
    info.className = "template-info";
    const title = document.createElement("strong");
    title.textContent = t(template.nameKey);
    const desc = document.createElement("span");
    desc.textContent = t(template.descKey);
    info.append(title, desc);
    card.append(thumb, info);
    card.addEventListener("click", async () => {
      closeModal("modal-templates");
      try {
        await createProject({
          name: t(template.nameKey),
          width: 1080,
          height: 1920,
          language: state.lang,
          palette,
          template: template.id,
        });
        toast(t("projectCreated"));
      } catch (error) {
        toast(String(error), true);
      }
    });
    grid.appendChild(card);
  }
  openModal("modal-templates");
}

/* ------------------------------------------------------------------ */
/* Chat / AI                                                           */
/* ------------------------------------------------------------------ */

function friendlyError(error) {
  const text = String(error);
  if (text.includes("402")) return t("errorBilling");
  if (text.includes("401")) return t("errorAuth");
  if (/opencode/i.test(text) && /introuvable|Impossible de lancer/i.test(text)) return t("errorOpencode");
  if (/dépassé|timeout|timed out/i.test(text)) return t("errorTimeout");
  return text;
}

const THINKING_STEPS = ["stepBrief", "stepPalette", "stepLayers", "stepCheck"];
let typingTimer = null;
let typingStarted = 0;

function showTyping() {
  removeTyping();
  typingStarted = Date.now();
  const row = document.createElement("div");
  row.id = "typing-row";
  row.className = "msg-row assistant typing-row";
  row.innerHTML = `
    <div class="msg-avatar">${icon("sparkles", 14)}</div>
    <div class="msg-content">
      <div class="msg-head"><span>${escapeHtml(t("chatAi"))}</span><span>${escapeHtml(t("thinking"))}</span></div>
      <div class="msg-bubble">
        <div class="typing-dots"><i class="typing-dot"></i><i class="typing-dot"></i><i class="typing-dot"></i></div>
        <div class="typing-status" id="typing-status"></div>
      </div>
    </div>`;
  $("#chat-messages").appendChild(row);
  updateTypingStatus();
  typingTimer = setInterval(() => updateTypingStatus(), 1000);
  scrollChat(true);
}

function updateTypingStatus(chars = 0) {
  const el = $("#typing-status");
  if (!el) return;
  const seconds = Math.max(1, Math.round((Date.now() - typingStarted) / 1000));
  const step = t(THINKING_STEPS[Math.floor(seconds / 4) % THINKING_STEPS.length]);
  const extra = chars ? ` · ${Number(chars).toLocaleString()} car.` : "";
  el.innerHTML = `${escapeHtml(step)} · <b>${seconds}s</b>${extra}`;
}

function removeTyping() {
  clearInterval(typingTimer);
  typingTimer = null;
  $("#typing-row")?.remove();
}

function retryLast() {
  const lastUser = [...state.chat].reverse().find((message) => message.role === "user");
  if (!lastUser) return;
  $("#chat-input").value = lastUser.content.replace(/^↻\s*/, "");
  autoGrow();
  sendChat(false, { silent: true });
}

async function sendChat(regenerate = false, { silent = false } = {}) {
  if (!state.project || state.generating) return;
  const backend = state.settings?.backend || "api";
  if (backend === "api" && !state.settings?.hasKey) {
    openSettings();
    toast(t("noApiKey"), true);
    return;
  }
  if (backend === "opencode" && !state.env?.opencode) {
    toast(t("errorOpencode"), true);
    return;
  }

  let instruction = $("#chat-input").value.trim();
  if (regenerate && !instruction) {
    const lastUser = [...state.chat].reverse().find((message) => message.role === "user");
    instruction = lastUser?.content || `${state.project.name} — ${state.project.width}×${state.project.height}`;
  }
  if (!instruction) {
    toast(t("enterPrompt"), true);
    $("#chat-input").focus();
    return;
  }

  if (!silent) {
    $("#chat-input").value = "";
    autoGrow();
    state.chat.push({
      role: "user",
      content: regenerate ? `↻ ${instruction}` : instruction,
      at: new Date().toISOString(),
    });
    renderChat();
    saveChat();
  }

  state.generating = true;
  state.genChars = 0;
  const button = $("#btn-send");
  button.disabled = true;
  showTyping();

  try {
    const document = await invoke("generate_design", {
      projectId: state.project.id,
      instruction,
      regenerate,
      selected: state.selection,
    });
    removeTyping();
    state.document = document;
    state.selection = [];
    state.editor.setAssets(state.assets);
    state.editor.setDocument(document, { reset: false });
    state.editor.select([]);
    renderLayers();
    renderStyle();
    renderChatSelection();
    state.chat.push({
      role: "assistant",
      content: `**${t("genDone")}** · ${document.layers.length} ${t("layersCount")}`,
      at: new Date().toISOString(),
    });
    saveChat();
    renderChat();
    markDirty();
    toast(t("genDone"));
  } catch (error) {
    removeTyping();
    const message = friendlyError(error);
    state.chat.push({
      role: "assistant",
      content: message,
      at: new Date().toISOString(),
      error: true,
    });
    saveChat();
    renderChat();
    toast(message, true);
  } finally {
    state.generating = false;
    button.disabled = false;
  }
}

async function saveChat() {
  if (!state.project) return;
  try {
    await invoke("save_chat", { projectId: state.project.id, chat: state.chat });
  } catch (error) {
    console.error(error);
  }
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

async function importFiles(files, addAsLayer = false) {
  if (!state.project) return;
  let lastName = null;
  for (const file of files) {
    const dataUrl = await readFile(file);
    const asset = await invoke("import_asset", {
      projectId: state.project.id,
      name: file.name,
      dataBase64: dataUrl,
    });
    lastName = asset.name;
  }
  const project = await invoke("open_project", { projectId: state.project.id });
  state.assets = project.assets;
  state.editor.setAssets(project.assets);
  renderAssets();
  if (addAsLayer && lastName) addImageLayer(lastName);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read error"));
    reader.readAsDataURL(file);
  });
}

function addTextLayer() {
  if (!state.document) return;
  const layer = normalizeLayer({
    id: uid(),
    type: "text",
    name: t("layerText"),
    text: "Votre texte",
    x: 80,
    y: 100,
    w: state.document.width - 160,
    h: 120,
    style: {
      fontFamily: "Anton",
      fontSize: 72,
      fontWeight: 400,
      color: state.document.palette?.[1] || "#f3f3fc",
      align: "left",
      valign: "top",
      lineHeight: 1,
      letterSpacing: 0,
      textTransform: "uppercase",
    },
  });
  state.editor.addLayer(layer);
  switchTab("style");
}

function addShapeLayer() {
  if (!state.document) return;
  const layer = normalizeLayer({
    id: uid(),
    type: "shape",
    name: t("layerShape"),
    shape: "rect",
    x: state.document.width / 2 - 100,
    y: state.document.height / 2 - 100,
    w: 200,
    h: 200,
    fill: state.document.palette?.[2] || "#7c3aed",
    radius: 12,
  });
  state.editor.addLayer(layer);
  switchTab("style");
}

function addImageLayer(assetName) {
  if (!state.document) return;
  const size = Math.min(state.document.width, state.document.height) * 0.55;
  const layer = normalizeLayer({
    id: uid(),
    type: "image",
    name: t("layerImage"),
    src: assetName,
    x: (state.document.width - size) / 2,
    y: (state.document.height - size) / 2,
    w: size,
    h: size,
    fit: "contain",
  });
  state.editor.addLayer(layer);
  switchTab("style");
}

/* ------------------------------------------------------------------ */
/* Saving / versions                                                   */
/* ------------------------------------------------------------------ */

function markDirty() {
  if (!state.project) return;
  state.dirty = true;
  setSaveState("saving");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 700);
}

async function saveNow() {
  if (!state.project || !state.editor?.doc) return;
  try {
    state.document = state.editor.doc;
    await invoke("save_document", { projectId: state.project.id, document: state.document });
    setSaveState("saved");
    state.dirty = false;
  } catch (error) {
    setSaveState("error");
    console.error(error);
  }
}

function setSaveState(status) {
  const el = $("#save-state");
  el.classList.toggle("saving", status === "saving");
  el.textContent =
    status === "saving" ? t("saving") : status === "error" ? t("saveError") : t("saved");
}

function startVersionTimer() {
  clearInterval(state.versionTimer);
  state.versionTimer = setInterval(async () => {
    if (!state.project || !state.dirty) return;
    try {
      await saveNow();
      await invoke("save_version", { projectId: state.project.id });
    } catch (error) {
      console.error(error);
    }
  }, 60000);
}

async function saveVersionManual() {
  if (!state.project) return;
  await saveNow();
  await invoke("save_version", { projectId: state.project.id });
  toast(t("versionCreated"));
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

async function buildExportHtml() {
  const document = state.document;
  const fontCss = await fontCssFor(document);
  const name = state.project?.name || "Affiche";
  return documentToHtml({ ...document, name }, state.assets, fontCss);
}

async function fontCssFor(document) {
  const families = new Set(
    (document.layers || [])
      .filter((layer) => layer.type === "text")
      .map((layer) => layer.style?.fontFamily || "Inter")
  );
  let css = "";
  try {
    css = await fetch("fonts.css").then((response) => response.text());
  } catch {
    return "";
  }
  const blocks = css.match(/@font-face\{[^}]+\}/g) || [];
  const used = blocks.filter((block) => {
    const match = block.match(/font-family:'([^']+)'/);
    return match && families.has(match[1]);
  });
  const cache = new Map();
  const output = [];
  for (const block of used) {
    const match = block.match(/url\('([^']+)'\)/);
    if (!match) {
      output.push(block);
      continue;
    }
    const url = match[1];
    if (!cache.has(url)) {
      const buffer = await fetch(url).then((response) => response.arrayBuffer());
      cache.set(url, `data:font/woff2;base64,${bufferToBase64(buffer)}`);
    }
    output.push(block.replace(url, cache.get(url)));
  }
  return output.join("\n");
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function exportAs(kind) {
  if (!state.project) return;
  try {
    await saveNow();
    await invoke("save_version", { projectId: state.project.id });
    const html = await buildExportHtml();
    let result;
    if (kind === "png1" || kind === "png2") {
      result = await invoke("export_png", {
        projectId: state.project.id,
        html,
        scale: kind === "png2" ? 2 : 1,
      });
    } else if (kind === "pdf") {
      result = await invoke("export_pdf", { projectId: state.project.id, html });
    } else {
      result = await invoke("export_html", { projectId: state.project.id, html });
    }
    closeModal("modal-export");
    const filename = result.path.split(/[\\/]/).pop();
    toast(`${t("exported")} · ${filename}`, false, result.path);
  } catch (error) {
    toast(String(error), true);
  }
}

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

async function openVersions() {
  if (!state.project) return;
  const list = $("#versions-list");
  list.innerHTML = "";
  try {
    const versions = await invoke("list_versions", { projectId: state.project.id });
    if (!versions.length) {
      const empty = document.createElement("div");
      empty.className = "empty-style";
      empty.textContent = t("noProjects");
      list.appendChild(empty);
    }
    for (const version of versions) {
      const row = document.createElement("div");
      row.className = "version-row";
      const meta = document.createElement("div");
      meta.className = "v-meta";
      meta.textContent = formatVersionDate(version.id);
      const small = document.createElement("small");
      small.textContent = `${version.layers} ${t("versionLayers")}`;
      meta.appendChild(small);
      const button = document.createElement("button");
      button.className = "btn btn-mini";
      button.textContent = t("restore");
      button.addEventListener("click", async () => {
        const document = await invoke("restore_version", {
          projectId: state.project.id,
          version: version.id,
        });
        state.document = document;
        state.selection = [];
        state.editor.setDocument(document, { reset: true });
        state.editor.setAssets(state.assets);
        renderLayers();
        renderStyle();
        closeModal("modal-versions");
        toast(t("restored"));
      });
      row.append(meta, button);
      list.appendChild(row);
    }
    openModal("modal-versions");
  } catch (error) {
    toast(String(error), true);
  }
}

function formatVersionDate(id) {
  const match = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!match) return id;
  const [, y, m, d, h, min] = match;
  return `${d}/${m}/${y} · ${h}:${min}`;
}

/* ------------------------------------------------------------------ */
/* Compte / mises à jour                                               */
/* ------------------------------------------------------------------ */

function openAccount() {
  $("#acc-current").textContent = state.env?.version ? `v${state.env.version}` : "—";
  const backend = state.settings?.backend || "api";
  $("#acc-backend").textContent = backend === "opencode" ? "OpenCode local" : t("apiBackend");
  $("#acc-model").textContent = state.settings?.model || "—";
  $("#acc-effort").textContent = state.settings?.reasoningEffort || "—";
  renderUpdateStatus();
  openModal("modal-account");
}

function renderUpdateStatus(failed = false) {
  const status = $("#update-status");
  const install = $("#btn-install-update");
  const notes = $("#update-notes");
  if (!status) return;
  status.classList.remove("ok", "available");
  notes.hidden = true;
  install.hidden = true;

  if (failed) {
    status.textContent = t("updateCheckFailed");
    return;
  }
  if (!state.update) {
    status.textContent = t("updatesHint");
    return;
  }
  if (state.update.available) {
    status.classList.add("available");
    status.textContent = `${t("updateAvailable")} · v${state.update.version}`;
    if (state.update.notes) {
      notes.textContent = state.update.notes;
      notes.hidden = false;
    }
    install.hidden = false;
    install.textContent = state.update.canAutoInstall ? t("installUpdate") : t("downloadUpdate");
  } else {
    status.classList.add("ok");
    status.textContent = t("upToDate");
  }
}

async function checkUpdates(silent = false) {
  const button = $("#btn-check-update");
  if (button) {
    button.disabled = true;
    button.textContent = t("checking");
  }
  try {
    const info = await invoke("check_update");
    state.update = info;
    renderUpdateStatus();
    const badge = $("#update-badge");
    if (badge) badge.hidden = !info.available;
    if (!silent) toast(info.available ? `${t("updateAvailable")} · v${info.version}` : t("upToDate"));
  } catch (error) {
    state.update = null;
    if (silent) {
      renderUpdateStatus();
    } else {
      renderUpdateStatus(true);
      toast(String(error), true);
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = t("checkUpdates");
    }
  }
}

async function installUpdate() {
  if (!state.update?.available) return;
  if (!state.update.canAutoInstall) {
    await invoke("open_url", {
      url: "https://github.com/unstasium/affiche-studio/releases/latest",
    }).catch((error) => toast(String(error), true));
    return;
  }
  const button = $("#btn-install-update");
  button.disabled = true;
  $("#update-status").textContent = t("updateStarted");
  try {
    await invoke("install_update");
    $("#update-status").textContent = t("updateReady");
    toast(t("updateReady"));
  } catch (error) {
    $("#update-status").textContent = t("updateFailed");
    toast(String(error), true);
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function openSettings() {
  const settings = state.settings || {};
  state.backend = settings.backend || "api";
  $("#set-base-url").value = settings.baseUrl || "https://api.openai.com/v1";
  $("#set-model").value = settings.model || "gpt-4o-mini";
  $("#set-opencode-model").value = state.backend === "opencode" ? settings.model || "" : "";
  $("#set-api-key").value = "";
  $("#set-remember").checked = Boolean(settings.rememberKey);
  $("#set-reasoning").value = settings.reasoningEffort || "";
  $("#key-hint").textContent = settings.hasKey ? t("apiConfigured") : t("apiHint");
  renderThemeSegments();
  renderAccentDots();
  renderLanguageSegments();
  renderBackendSegments();
  openModal("modal-settings");
}

function renderBackendSegments() {
  const apply = () => {
    $$("#set-backend button").forEach((button) => {
      button.classList.toggle("active", button.dataset.backend === state.backend);
    });
    $("#api-fields").hidden = state.backend !== "api";
    $("#opencode-fields").hidden = state.backend !== "opencode";
    $("#btn-clear-key").hidden = state.backend !== "api";
  };
  $$("#set-backend button").forEach((button) => {
    button.onclick = () => {
      state.backend = button.dataset.backend;
      apply();
    };
  });
  apply();
}

function renderThemeSegments() {
  $$("#set-theme button").forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === state.theme);
    button.onclick = () => {
      state.theme = button.dataset.theme;
      applyPreferences();
      renderThemeSegments();
    };
  });
}

function renderAccentDots() {
  const row = $("#set-accent");
  row.innerHTML = "";
  for (const color of ACCENTS) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "accent-dot" + (color === state.accent ? " active" : "");
    dot.style.background = color;
    dot.title = color;
    dot.addEventListener("click", () => {
      state.accent = color;
      applyPreferences();
      renderAccentDots();
    });
    row.appendChild(dot);
  }
}

function renderLanguageSegments() {
  $$("#set-language button").forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === state.lang);
    button.onclick = () => {
      state.lang = button.dataset.lang;
      setLanguage(state.lang).then(() => {
        renderLanguageSegments();
        renderAll();
      });
    };
  });
}

async function saveSettings(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const backend = state.backend || "api";
    const apiKey = $("#set-api-key").value.trim();
    const model = backend === "api"
      ? $("#set-model").value.trim()
      : $("#set-opencode-model").value.trim();
    const baseUrl = backend === "api"
      ? $("#set-base-url").value.trim()
      : (state.settings?.baseUrl || "https://api.openai.com/v1");
    state.settings = await invoke("save_settings", {
      baseUrl,
      model,
      apiKey: backend === "api" ? apiKey || null : null,
      rememberKey: backend === "api" ? $("#set-remember").checked : false,
      reasoningEffort: $("#set-reasoning").value || null,
      backend,
    });
    localStorage.setItem("as.lang", state.lang);
    localStorage.setItem("as.theme", state.theme);
    localStorage.setItem("as.accent", state.accent);
    await setLanguage(state.lang);
    applyPreferences();
    renderAll();
    closeModal("modal-settings");
    toast(t("save"));
  } catch (error) {
    toast(String(error), true);
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Project meta                                                        */
/* ------------------------------------------------------------------ */

function openMeta() {
  if (!state.project) return;
  $("#meta-name").value = state.project.name;
  const applyMetaLanguage = (value) => {
    state.project.language = value;
    renderSegmented($("#meta-language"), "lang", value, applyMetaLanguage);
  };
  renderSegmented($("#meta-language"), "lang", state.project.language, applyMetaLanguage);
  const applyMetaPalette = (colors) => {
    state.project.palette = colors;
    renderPaletteRow($("#meta-palettes"), colors, applyMetaPalette);
  };
  renderPaletteRow($("#meta-palettes"), state.project.palette, applyMetaPalette);
  openModal("modal-meta");
}

async function saveMeta(event) {
  event.preventDefault();
  try {
    await invoke("update_project_meta", {
      projectId: state.project.id,
      name: $("#meta-name").value.trim(),
      language: state.project.language,
      palette: state.project.palette,
    });
    state.project.name = $("#meta-name").value.trim();
    $("#project-name").textContent = state.project.name;
    state.projects = await invoke("list_projects");
    renderProjects();
    closeModal("modal-meta");
    toast(t("save"));
  } catch (error) {
    toast(String(error), true);
  }
}

async function deleteCurrentProject() {
  if (!state.project) return;
  if (!confirm(`${t("deleteProject")} « ${state.project.name} » ?`)) return;
  try {
    await invoke("delete_project", { projectId: state.project.id });
    state.project = null;
    state.document = null;
    state.projects = await invoke("list_projects");
    $("#workspace").hidden = true;
    $("#empty-state").hidden = false;
    $("#app").classList.add("no-project");
    closeModal("modal-meta");
    renderProjects();
    toast(t("projectDeleted"));
  } catch (error) {
    toast(String(error), true);
  }
}

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

function commandList() {
  return [
    { label: t("cmdNew"), run: openNewProject },
    { label: t("cmdTemplates"), run: openTemplates },
    { label: t("cmdExport"), run: () => state.project && openModal("modal-export") },
    { label: t("cmdTheme"), run: toggleTheme },
    { label: t("cmdLanguage"), run: cycleLanguage },
    { label: t("cmdSettings"), run: openSettings },
    { label: t("cmdUndo"), run: () => state.editor.undo() },
    { label: t("cmdRedo"), run: () => state.editor.redo() },
    { label: t("cmdDuplicate"), run: duplicateProject },
    { label: t("cmdVersions"), run: openVersions },
    { label: t("cmdAddText"), run: addTextLayer },
    { label: t("cmdAddImage"), run: () => $("#file-input").click() },
    { label: t("cmdAddShape"), run: addShapeLayer },
    { label: t("cmdFit"), run: () => state.editor.fit() },
    { label: t("cmdSaveVersion"), run: saveVersionManual },
  ];
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyPreferences();
  localStorage.setItem("as.theme", state.theme);
  toast(t("themeChanged"));
}

function cycleLanguage() {
  const languages = ["fr", "en", "es"];
  const next = languages[(languages.indexOf(state.lang) + 1) % languages.length];
  state.lang = next;
  localStorage.setItem("as.lang", state.lang);
  setLanguage(next).then(() => {
    renderAll();
    toast(t("languageChanged"));
  });
}

async function duplicateProject() {
  if (!state.project) return;
  try {
    const project = await invoke("duplicate_project", { projectId: state.project.id });
    state.projects = await invoke("list_projects");
    renderProjects();
    await openProject(project.id);
    toast(t("projectDuplicated"));
  } catch (error) {
    toast(String(error), true);
  }
}

function openPalette() {
  state.paletteCommands = commandList();
  state.paletteIndex = 0;
  $("#palette-input").value = "";
  renderPalette();
  openModal("modal-palette");
  setTimeout(() => $("#palette-input").focus(), 40);
}

function renderPalette() {
  const query = ($("#palette-input").value || "").toLowerCase();
  const filtered = state.paletteCommands.filter((command) =>
    command.label.toLowerCase().includes(query)
  );
  const list = $("#palette-list");
  list.innerHTML = "";
  filtered.forEach((command, index) => {
    const button = document.createElement("button");
    button.className = "palette-item" + (index === state.paletteIndex ? " active" : "");
    button.innerHTML = `<span class="pi-label">${escapeText(command.label)}</span><span class="pi-hint">${t("commandHint")}</span>`;
    button.addEventListener("click", () => {
      closeModal("modal-palette");
      command.run();
    });
    list.appendChild(button);
  });
  state.paletteFiltered = filtered;
}

function escapeText(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

/* ------------------------------------------------------------------ */
/* Modals / toast                                                      */
/* ------------------------------------------------------------------ */

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = false;
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = true;
}

function switchTab(name) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
}

function toast(message, isError = false, path = null) {
  const el = $("#toast");
  el.hidden = false;
  el.classList.toggle("error", isError);
  $("#toast-text").textContent = message;
  state.toastPath = path;
  $("#toast-action").hidden = !path;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.hidden = true;
    state.toastPath = null;
  }, path ? 9000 : 4200);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

let contextTarget = null;

function openContextMenu(event) {
  const layerEl = event.target.closest?.(".canvas-layer");
  hideContextMenu();
  if (!layerEl) return;
  event.preventDefault();
  const id = layerEl.dataset.layerId;
  const layer = state.document?.layers.find((value) => value.id === id);
  if (!layer) return;
  if (!state.selection.includes(id)) state.editor.select([id]);
  contextTarget = layer;
  const menu = $("#context-menu");
  menu.innerHTML = "";

  const add = (label, iconName, action, danger = false) => {
    const button = document.createElement("button");
    button.innerHTML = `${icon(iconName, 14)} <span>${escapeHtml(label)}</span>`;
    if (danger) button.classList.add("danger");
    button.addEventListener("click", () => {
      hideContextMenu();
      action();
    });
    menu.appendChild(button);
  };
  const sep = () => {
    const line = document.createElement("div");
    line.className = "sep";
    menu.appendChild(line);
  };

  add(t("duplicate"), "copy", () => state.editor.duplicateSelection());
  add(t("bringForward"), "arrowUp", () => state.editor.bringForward());
  add(t("sendBackward"), "arrowDown", () => state.editor.sendBackward());
  sep();
  add(layer.locked ? t("unlock") : t("lock"), layer.locked ? "unlock" : "lock", () =>
    state.editor.updateLayer(layer.id, { locked: !layer.locked })
  );
  add(layer.hidden ? t("show") : t("hide"), layer.hidden ? "eye" : "eyeOff", () =>
    state.editor.updateLayer(layer.id, { hidden: !layer.hidden })
  );
  sep();
  add(t("delete"), "trash", () => state.editor.deleteSelection(), true);

  menu.hidden = false;
  const width = 200;
  const height = menu.offsetHeight || 240;
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - height - 8)}px`;
  paintIcons(menu);
}

function hideContextMenu() {
  const menu = $("#context-menu");
  if (menu) menu.hidden = true;
  contextTarget = null;
}

function bindEvents() {
  $("#btn-account").addEventListener("click", openAccount);
  $("#btn-check-update").addEventListener("click", () => checkUpdates(false));
  $("#btn-install-update").addEventListener("click", installUpdate);
  $$("[data-url]").forEach((button) => {
    button.addEventListener("click", () =>
      invoke("open_url", { url: button.dataset.url }).catch((error) => toast(String(error), true))
    );
  });
  $("#btn-new").addEventListener("click", openNewProject);
  $("#btn-new-2").addEventListener("click", openNewProject);
  $("#btn-templates").addEventListener("click", openTemplates);
  $("#btn-templates-2").addEventListener("click", openTemplates);
  $("#btn-settings").addEventListener("click", openSettings);

  $("#project-search").addEventListener("input", renderProjects);
  $("#project-format").addEventListener("click", openMeta);
  $("#btn-versions").addEventListener("click", openVersions);
  $("#btn-export").addEventListener("click", () => openModal("modal-export"));
  $("#btn-undo").addEventListener("click", () => state.editor.undo());
  $("#btn-redo").addEventListener("click", () => state.editor.redo());
  $("#zoom-in").addEventListener("click", () => {
    state.zoomed = true;
    state.editor.setZoom(state.editor.scale * 1.15);
  });
  $("#zoom-out").addEventListener("click", () => {
    state.zoomed = true;
    state.editor.setZoom(state.editor.scale / 1.15);
  });
  $("#zoom-fit").addEventListener("click", () => {
    state.zoomed = false;
    state.editor.fit();
  });
  $("#zoom-label").addEventListener("click", () => {
    state.zoomed = true;
    state.editor.setZoom(1);
  });
  $("#canvas").addEventListener("contextmenu", openContextMenu);
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("#context-menu")) hideContextMenu();
  });
  $("#chat-scroll").addEventListener("scroll", hideContextMenu);

  $("#tabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) switchTab(tab.dataset.tab);
  });

  $("#btn-send").addEventListener("click", () => sendChat(false));
  $("#btn-regenerate").addEventListener("click", () => sendChat(true));
  $("#btn-help").addEventListener("click", () => openModal("modal-help"));
  $("#chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendChat(false);
    }
  });
  $("#chat-input").addEventListener("input", autoGrow);
  $("#chat-scroll").addEventListener("scroll", updateScrollButton);
  $("#scroll-bottom").addEventListener("click", () => scrollChat(true));

  $$("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.add === "text") addTextLayer();
      else if (button.dataset.add === "shape") addShapeLayer();
      else $("#file-input").click();
    });
  });
  $("#btn-import-assets").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", async (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    try {
      await importFiles(files, true);
    } catch (error) {
      toast(String(error), true);
    }
  });

  $("#btn-group").addEventListener("click", () => state.editor.groupSelection());
  $("#btn-ungroup").addEventListener("click", () => state.editor.ungroupSelection());
  $("#btn-duplicate").addEventListener("click", () => state.editor.duplicateSelection());
  $("#btn-delete-layer").addEventListener("click", () => state.editor.deleteSelection());

  $$(".modal [data-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.close));
  });
  $$(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal.id);
    });
  });

  $("#project-form").addEventListener("submit", onCreateProject);
  $("#settings-form").addEventListener("submit", saveSettings);
  $("#meta-form").addEventListener("submit", saveMeta);
  $("#btn-delete-project").addEventListener("click", deleteCurrentProject);
  $("#btn-clear-key").addEventListener("click", async () => {
    state.settings = await invoke("clear_api_key");
    openSettings();
    renderApiStatus();
  });

  $$("#modal-export [data-export]").forEach((button) => {
    button.addEventListener("click", () => exportAs(button.dataset.export));
  });

  $("#toast-action").addEventListener("click", () => {
    if (state.toastPath) invoke("reveal_path", { path: state.toastPath }).catch(() => {});
  });

  $("#palette-input").addEventListener("input", () => {
    state.paletteIndex = 0;
    renderPalette();
  });
  $("#palette-input").addEventListener("keydown", (event) => {
    const filtered = state.paletteFiltered || [];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.paletteIndex = Math.min(filtered.length - 1, state.paletteIndex + 1);
      renderPalette();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.paletteIndex = Math.max(0, state.paletteIndex - 1);
      renderPalette();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[state.paletteIndex];
      if (command) {
        closeModal("modal-palette");
        command.run();
      }
    }
  });

  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", () => {
    if (!state.zoomed) state.editor.fit();
  });
}

function pasteLayers() {
  if (!state.clipboard.length || !state.document) return;
  state.editor.pushHistory();
  const created = [];
  for (const layer of state.clipboard) {
    const clone = JSON.parse(JSON.stringify(layer));
    clone.id = uid();
    clone.name = `${layer.name} copie`;
    clone.x += 24;
    clone.y += 24;
    clone.groupId = null;
    state.document.layers.push(clone);
    created.push(clone.id);
  }
  state.editor.render();
  state.editor.select(created);
  state.editor.onChange();
}

function onKeyDown(event) {
  const target = event.target;
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable;

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openPalette();
    return;
  }
  if (event.key === "Escape") {
    $$(".modal:not([hidden])").forEach((modal) => closeModal(modal.id));
    if (state.editor) state.editor.select([]);
    return;
  }
  if (event.key === "?" && !typing) {
    event.preventDefault();
    openModal("modal-help");
    return;
  }
  if (typing || !state.project) return;

  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) state.editor.redo();
    else state.editor.undo();
    return;
  }
  if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault();
    state.editor.redo();
    return;
  }
  if (mod && event.key.toLowerCase() === "d") {
    event.preventDefault();
    state.editor.duplicateSelection();
    return;
  }
  if (mod && event.key.toLowerCase() === "g") {
    event.preventDefault();
    if (event.shiftKey) state.editor.ungroupSelection();
    else state.editor.groupSelection();
    return;
  }
  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveVersionManual();
    return;
  }
  if (mod && event.key.toLowerCase() === "e") {
    event.preventDefault();
    openModal("modal-export");
    return;
  }
  if (mod && event.key.toLowerCase() === "n") {
    event.preventDefault();
    openNewProject();
    return;
  }
  if (mod && event.key.toLowerCase() === "c" && state.selection.length) {
    event.preventDefault();
    state.clipboard = state.editor.getSelection().map((layer) => JSON.parse(JSON.stringify(layer)));
    toast(t("copied"));
    return;
  }
  if (mod && event.key.toLowerCase() === "v" && state.clipboard.length) {
    event.preventDefault();
    pasteLayers();
    return;
  }
  if (event.key.toLowerCase() === "t" && !mod) {
    event.preventDefault();
    addTextLayer();
    return;
  }
  if (event.shiftKey && event.code === "Digit1") {
    event.preventDefault();
    state.zoomed = false;
    state.editor.fit();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    state.editor.deleteSelection();
    return;
  }
  if (event.key.startsWith("Arrow") && state.selection.length) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    for (const id of state.selection) {
      const layer = state.document.layers.find((value) => value.id === id);
      if (!layer || layer.locked) continue;
      layer.x += dx;
      layer.y += dy;
      state.editor.applyLayer(layer);
    }
    state.editor.renderOverlay();
    markDirty();
  }
}

async function onCreateProject(event) {
  event.preventDefault();
  const name = $("#proj-name").value.trim();
  if (!name) return;
  let width;
  let height;
  if (state.selectedFormat === "custom") {
    width = Number($("#proj-width").value);
    height = Number($("#proj-height").value);
  } else {
    const format = FORMATS.find((value) => value.id === state.selectedFormat);
    width = format.w;
    height = format.h;
  }
  if (!width || !height) return;
  try {
    await createProject({
      name,
      width,
      height,
      language: state.projectLang,
      palette: state.selectedPalette,
    });
    closeModal("modal-project");
    toast(t("projectCreated"));
  } catch (error) {
    toast(String(error), true);
  }
}

boot();
