const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (sel) => document.querySelector(sel);

const state = {
  settings: null,
  projects: [],
  project: null,
  generating: false,
  toastTimer: null,
  toastPath: null,
  env: null,
};

const FORMATS = {
  "1080x1920": "Story · 1080 × 1920",
  "1080x1080": "Carré · 1080 × 1080",
  "2480x3508": "A4 · 2480 × 3508",
  "3508x4961": "A3 · 3508 × 4961",
};

function formatLabel(width, height) {
  return FORMATS[`${width}x${height}`] || `${width} × ${height}`;
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  bindEvents();
  await listen("gen-stage", (event) => {
    const stage = event.payload?.stage;
    if (stage === "connexion") setGenStatus("Connexion au modèle…");
  });
  await listen("gen-chunk", (event) => {
    appendLog(event.payload?.text || "");
  });
  await listen("gen-error", (event) => {
    setGenStatus(event.payload?.message || "Erreur de génération", true);
  });
  await listen("gen-done", () => {
    setGenStatus("Affiche générée ✓");
  });

  try {
    state.settings = await invoke("get_settings");
    state.projects = await invoke("list_projects");
  } catch (error) {
    toast(String(error), true);
  }
  renderProjects();
  renderApiStatus();

  try {
    state.env = await invoke("environment");
  } catch (_) {}

  if (state.env?.devOpen) {
    await openProject(state.env.devOpen);
  } else if (!state.settings?.hasKey) {
    openModal("modal-settings");
    fillSettings();
  }
}

function bindEvents() {
  $("#btn-new").addEventListener("click", openProjectModal);
  $("#btn-new-2").addEventListener("click", openProjectModal);
  $("#btn-settings").addEventListener("click", () => {
    fillSettings();
    openModal("modal-settings");
  });
  $("#btn-settings-2").addEventListener("click", () => {
    fillSettings();
    openModal("modal-settings");
  });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal.id);
    });
  });

  $("#project-form").addEventListener("submit", onCreateProject);
  $("#settings-form").addEventListener("submit", onSaveSettings);
  $("#btn-clear-key").addEventListener("click", onClearKey);

  $("#proj-format").addEventListener("change", () => {
    const custom = $("#proj-format").value === "custom";
    $("#custom-size").hidden = !custom;
  });

  $("#btn-import").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", onImportFiles);
  $("#btn-generate").addEventListener("click", generate);
  $("#btn-export-png").addEventListener("click", () => exportAsset("png"));
  $("#btn-export-html").addEventListener("click", () => exportAsset("html"));
  $("#btn-delete").addEventListener("click", deleteProject);
  $("#btn-reload").addEventListener("click", refreshPreview);
  $("#toast-action").addEventListener("click", () => {
    if (state.toastPath) invoke("reveal_path", { path: state.toastPath }).catch(() => {});
  });

  $("#prompt").addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      generate();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".modal:not([hidden])").forEach((m) => closeModal(m.id));
    }
  });

  window.addEventListener("resize", fitPreview);
  if (window.ResizeObserver) {
    new ResizeObserver(fitPreview).observe($("#preview-wrap"));
  }
}

/* ------------------------------------------------------------------ */
/* Sidebar / projects                                                  */
/* ------------------------------------------------------------------ */

function renderProjects() {
  const list = $("#project-list");
  list.innerHTML = "";
  if (!state.projects.length) {
    const empty = document.createElement("div");
    empty.className = "projects-empty";
    empty.textContent = "Aucun projet pour l'instant.";
    list.appendChild(empty);
    return;
  }
  for (const project of state.projects) {
    const item = document.createElement("button");
    item.className = "project-item" + (state.project?.id === project.id ? " active" : "");
    const name = document.createElement("span");
    name.className = "pi-name";
    name.textContent = project.name;
    const meta = document.createElement("span");
    meta.className = "pi-meta";
    meta.textContent = formatLabel(project.width, project.height);
    item.append(name, meta);
    item.addEventListener("click", () => openProject(project.id));
    list.appendChild(item);
  }
}

async function openProject(id) {
  try {
    state.project = await invoke("open_project", { projectId: id });
    $("#empty-state").hidden = true;
    $("#editor").hidden = false;
    $("#project-name").textContent = state.project.name;
    $("#project-meta").textContent = `${state.project.width} × ${state.project.height}`;
    $("#preview-size").textContent = `${state.project.width} × ${state.project.height} px`;
    $("#prompt").value = localStorage.getItem(`brief:${id}`) || "";
    renderAssets();
    renderProjects();
    await refreshPreview();
    setTimeout(fitPreview, 50);
  } catch (error) {
    toast(String(error), true);
  }
}

function openProjectModal() {
  $("#project-form").reset();
  $("#custom-size").hidden = true;
  openModal("modal-project");
  setTimeout(() => $("#proj-name").focus(), 60);
}

async function onCreateProject(event) {
  event.preventDefault();
  const name = $("#proj-name").value.trim();
  const format = $("#proj-format").value;
  let width = 1080;
  let height = 1920;
  if (format === "custom") {
    width = Number($("#proj-width").value);
    height = Number($("#proj-height").value);
  } else {
    [width, height] = format.split("x").map(Number);
  }
  const button = event.submitter;
  button.disabled = true;
  try {
    const project = await invoke("create_project", { name, width, height });
    state.projects = await invoke("list_projects");
    closeModal("modal-project");
    await openProject(project.id);
    toast("Projet créé");
  } catch (error) {
    toast(String(error), true);
  } finally {
    button.disabled = false;
  }
}

async function deleteProject() {
  if (!state.project) return;
  if (!confirm(`Supprimer « ${state.project.name} » et tous ses fichiers ?`)) return;
  try {
    await invoke("delete_project", { projectId: state.project.id });
    state.project = null;
    state.projects = await invoke("list_projects");
    $("#editor").hidden = true;
    $("#empty-state").hidden = false;
    renderProjects();
    toast("Projet supprimé");
  } catch (error) {
    toast(String(error), true);
  }
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

function renderAssets() {
  const grid = $("#asset-grid");
  grid.innerHTML = "";
  const assets = state.project?.assets || [];
  if (!assets.length) {
    const empty = document.createElement("div");
    empty.className = "assets-empty";
    empty.textContent = "Images, logos, polices…";
    grid.appendChild(empty);
    return;
  }
  for (const asset of assets) {
    const tile = document.createElement("div");
    tile.className = "asset";
    const isFont = /\.(woff2?|ttf|otf)$/i.test(asset.name);
    if (isFont) {
      tile.classList.add("font-tile");
      const glyph = document.createElement("div");
      glyph.className = "glyph";
      glyph.textContent = "Aa";
      tile.appendChild(glyph);
    } else {
      const preview = document.createElement("div");
      preview.className = "asset-preview";
      preview.style.backgroundImage = `url("${asset.dataUrl}")`;
      preview.setAttribute("role", "img");
      preview.setAttribute("aria-label", asset.name);
      tile.appendChild(preview);
    }
    const label = document.createElement("div");
    label.className = "asset-name";
    label.textContent = asset.name;
    tile.appendChild(label);
    grid.appendChild(tile);
  }
}

async function onImportFiles(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (!files.length || !state.project) return;
  const button = $("#btn-import");
  button.disabled = true;
  button.textContent = "Import…";
  try {
    for (const file of files) {
      const dataUrl = await readFileAsDataUrl(file);
      await invoke("import_asset", {
        projectId: state.project.id,
        name: file.name,
        dataBase64: dataUrl,
      });
    }
    await openProject(state.project.id);
    toast(files.length > 1 ? `${files.length} fichiers importés` : "Fichier importé");
  } catch (error) {
    toast(String(error), true);
  } finally {
    button.disabled = false;
    button.textContent = "Importer";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

async function refreshPreview() {
  if (!state.project) return;
  try {
    const html = await invoke("preview_html", { projectId: state.project.id });
    const empty = $("#preview-empty");
    const scaler = $("#preview-scaler");
    const iframe = $("#preview");
    if (!html.trim()) {
      empty.hidden = false;
      scaler.hidden = true;
      iframe.srcdoc = "";
      return;
    }
    empty.hidden = true;
    scaler.hidden = false;
    iframe.style.width = `${state.project.width}px`;
    iframe.style.height = `${state.project.height}px`;
    iframe.srcdoc = html;
    setTimeout(fitPreview, 30);
  } catch (error) {
    toast(String(error), true);
  }
}

function fitPreview() {
  if (!state.project) return;
  const wrap = $("#preview-wrap");
  const scaler = $("#preview-scaler");
  if (!wrap || !scaler || scaler.hidden) return;
  const width = state.project.width;
  const height = state.project.height;
  const padding = 52;
  const availableW = Math.max(80, wrap.clientWidth - padding);
  const availableH = Math.max(80, wrap.clientHeight - padding);
  const scale = Math.min(availableW / width, availableH / height, 1.4);
  scaler.style.width = `${width}px`;
  scaler.style.height = `${height}px`;
  scaler.style.left = `${(wrap.clientWidth - width) / 2}px`;
  scaler.style.top = `${(wrap.clientHeight - height) / 2}px`;
  scaler.style.transform = `scale(${scale})`;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

function setGenStatus(text, isError = false) {
  const status = $("#gen-status");
  status.hidden = false;
  status.classList.toggle("error", isError);
  $("#gen-status-text").textContent = text;
}

function appendLog(text) {
  const log = $("#gen-log");
  log.hidden = false;
  const next = (log.dataset.buffer || "") + text;
  log.dataset.buffer = next.length > 6000 ? next.slice(-6000) : next;
  log.textContent = log.dataset.buffer;
  log.scrollTop = log.scrollHeight;
}

async function generate() {
  if (!state.project || state.generating) return;
  const prompt = $("#prompt").value.trim();
  if (!prompt) {
    toast("Décrivez d'abord l'affiche.", true);
    $("#prompt").focus();
    return;
  }
  if (!state.settings?.hasKey) {
    fillSettings();
    openModal("modal-settings");
    toast("Configurez d'abord votre clé API.", true);
    return;
  }

  localStorage.setItem(`brief:${state.project.id}`, prompt);

  state.generating = true;
  const button = $("#btn-generate");
  button.disabled = true;
  button.textContent = "Génération…";
  const log = $("#gen-log");
  log.hidden = true;
  log.dataset.buffer = "";
  log.textContent = "";
  setGenStatus("Connexion au modèle…");

  try {
    await invoke("generate_poster", {
      projectId: state.project.id,
      prompt,
    });
    await openProject(state.project.id);
    setGenStatus("Affiche générée ✓");
    toast("Affiche générée");
  } catch (error) {
    setGenStatus(String(error), true);
    toast(String(error), true);
  } finally {
    state.generating = false;
    button.disabled = false;
    button.textContent = "Générer l'affiche";
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

async function exportAsset(kind) {
  if (!state.project) return;
  try {
    const result = await invoke(kind === "png" ? "export_png" : "export_html", {
      projectId: state.project.id,
    });
    const name = result.path.split(/[\\/]/).pop();
    toast(`${kind === "png" ? "PNG" : "HTML"} exporté : ${name}`, false, result.path);
  } catch (error) {
    toast(String(error), true);
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function fillSettings() {
  const settings = state.settings || {};
  $("#set-base-url").value = settings.baseUrl || "";
  $("#set-model").value = settings.model || "";
  $("#set-api-key").value = "";
  $("#set-remember").checked = Boolean(settings.rememberKey);
  $("#key-hint").textContent = settings.hasKey
    ? "Une clé est déjà enregistrée. Laissez vide pour la conserver."
    : "Laissez vide pour conserver la clé actuelle.";
}

async function onSaveSettings(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const apiKey = $("#set-api-key").value.trim();
    state.settings = await invoke("save_settings", {
      baseUrl: $("#set-base-url").value.trim(),
      model: $("#set-model").value.trim(),
      apiKey: apiKey || null,
      rememberKey: $("#set-remember").checked,
    });
    closeModal("modal-settings");
    renderApiStatus();
    toast("Réglages enregistrés");
  } catch (error) {
    toast(String(error), true);
  } finally {
    button.disabled = false;
  }
}

async function onClearKey() {
  try {
    state.settings = await invoke("clear_api_key");
    fillSettings();
    renderApiStatus();
    toast("Clé API effacée");
  } catch (error) {
    toast(String(error), true);
  }
}

function renderApiStatus() {
  const dot = $("#api-dot");
  const label = $("#api-label");
  const ok = Boolean(state.settings?.hasKey);
  dot.classList.toggle("ok", ok);
  label.textContent = ok ? state.settings.model || "Configurée" : "Non configurée";
}

/* ------------------------------------------------------------------ */
/* Modal / toast                                                       */
/* ------------------------------------------------------------------ */

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = false;
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = true;
}

function toast(message, isError = false, path = null) {
  const el = $("#toast");
  const text = $("#toast-text");
  const action = $("#toast-action");
  text.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  state.toastPath = path;
  action.hidden = !path;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.hidden = true;
    state.toastPath = null;
  }, path ? 9000 : 4800);
}

boot();
