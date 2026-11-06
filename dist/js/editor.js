import { createLayerElement, layerCss } from "./render.js";

const MIN_SIZE = 8;
const SNAP = 6;
const HISTORY_LIMIT = 80;

export class Editor {
  constructor({ shell, canvas, overlay, guides, onChange, onSelection, onZoom }) {
    this.shell = shell;
    this.canvas = canvas;
    this.overlay = overlay;
    this.guides = guides;
    this.onChange = onChange || (() => {});
    this.onSelection = onSelection || (() => {});
    this.onZoom = onZoom || (() => {});

    this.doc = null;
    this.assets = [];
    this.selection = [];
    this.history = [];
    this.future = [];
    this.scale = 1;
    this.drag = null;
    this.editing = null;

    this.canvas.addEventListener("pointerdown", (event) => this.handleCanvasDown(event));
    this.overlay.addEventListener("pointerdown", (event) => this.handleOverlayDown(event));
    this.canvas.addEventListener("dblclick", (event) => this.handleDoubleClick(event));
    window.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    window.addEventListener("pointerup", (event) => this.handlePointerUp(event));
  }

  setDocument(doc, { reset = false } = {}) {
    this.doc = doc;
    if (reset) {
      this.history = [];
      this.future = [];
      this.selection = [];
    }
    this.render();
    this.fit();
  }

  setAssets(assets) {
    this.assets = assets;
    this.render();
  }

  setZoom(scale) {
    if (!this.doc) return;
    this.scale = Math.max(0.05, Math.min(4, scale));
    this.shell.style.transform = `translate(-50%, -50%) scale(${this.scale})`;
    this.renderOverlay();
    this.onZoom(this.scale);
  }

  fit() {
    if (!this.doc) return;
    const stage = this.canvas.closest(".stage");
    if (!stage) return;
    const sx = (stage.clientWidth - 70) / this.doc.width;
    const sy = (stage.clientHeight - 70) / this.doc.height;
    this.setZoom(Math.min(sx, sy, 1.4));
  }

  render() {
    if (!this.doc) return;
    this.shell.style.width = `${this.doc.width}px`;
    this.shell.style.height = `${this.doc.height}px`;
    this.canvas.style.width = `${this.doc.width}px`;
    this.canvas.style.height = `${this.doc.height}px`;
    this.canvas.style.background = this.doc.background || "#0b0b0e";
    this.canvas.innerHTML = "";
    for (const layer of this.doc.layers || []) {
      const el = createLayerElement(layer, this.assets, { editor: true });
      el.dataset.layerId = layer.id;
      this.canvas.appendChild(el);
    }
    this.renderOverlay();
  }

  layerEl(id) {
    return this.canvas.querySelector(`[data-layer-id="${CSS.escape(id)}"]`);
  }

  applyLayer(layer) {
    const el = this.layerEl(layer.id);
    if (!el) return;
    const css = layerCss(layer);
    for (const [key, value] of Object.entries(css)) {
      if (value !== undefined && value !== null) el.style[key] = value;
    }
    el.style.pointerEvents = layer.locked || layer.hidden ? "none" : "auto";
    el.style.cursor = layer.locked ? "default" : "move";
  }

  getSelection() {
    return this.selection
      .map((id) => this.doc?.layers.find((layer) => layer.id === id))
      .filter(Boolean);
  }

  select(ids, silent = false) {
    this.selection = [...new Set(ids)].filter((id) => this.doc?.layers.some((l) => l.id === id));
    this.renderOverlay();
    if (!silent) this.onSelection(this.selection);
  }

  toggleSelect(id) {
    if (this.selection.includes(id)) {
      this.select(this.selection.filter((value) => value !== id));
    } else {
      this.select([...this.selection, id]);
    }
  }

  renderOverlay() {
    this.overlay.innerHTML = "";
    if (!this.doc || !this.selection.length) return;
    const layers = this.getSelection();
    if (!layers.length) return;

    if (layers.length === 1) {
      const layer = layers[0];
      const box = document.createElement("div");
      box.className = "sel-box";
      box.style.left = `${layer.x}px`;
      box.style.top = `${layer.y}px`;
      box.style.width = `${layer.w}px`;
      box.style.height = `${layer.h}px`;
      box.style.transform = `rotate(${layer.rotation || 0}deg)`;
      box.style.borderWidth = `${Math.max(1, 1.5 / this.scale)}px`;
      const hs = Math.max(7, 11 / this.scale);
      for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
        const dot = document.createElement("div");
        dot.className = "sel-handle";
        dot.dataset.h = handle;
        dot.style.width = `${hs}px`;
        dot.style.height = `${hs}px`;
        dot.style.borderWidth = `${Math.max(1, 2 / this.scale)}px`;
        box.appendChild(dot);
      }
      const rotate = document.createElement("div");
      rotate.className = "sel-handle rot";
      rotate.dataset.h = "rot";
      rotate.style.width = `${hs}px`;
      rotate.style.height = `${hs}px`;
      rotate.style.borderWidth = `${Math.max(1, 2 / this.scale)}px`;
      box.appendChild(rotate);
      this.overlay.appendChild(box);
    } else {
      const minX = Math.min(...layers.map((l) => l.x));
      const minY = Math.min(...layers.map((l) => l.y));
      const maxX = Math.max(...layers.map((l) => l.x + l.w));
      const maxY = Math.max(...layers.map((l) => l.y + l.h));
      const box = document.createElement("div");
      box.className = "sel-box multi";
      box.style.left = `${minX}px`;
      box.style.top = `${minY}px`;
      box.style.width = `${maxX - minX}px`;
      box.style.height = `${maxY - minY}px`;
      box.style.borderWidth = `${Math.max(1, 1.5 / this.scale)}px`;
      this.overlay.appendChild(box);
    }
  }

  docPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / this.doc.width || 1;
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
      scale,
    };
  }

  handleCanvasDown(event) {
    if (this.editing) return;
    const layerEl = event.target.closest?.(".canvas-layer");
    if (!layerEl) {
      this.select([]);
      return;
    }
    event.preventDefault();
    const id = layerEl.dataset.layerId;
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      this.toggleSelect(id);
    } else if (!this.selection.includes(id)) {
      this.select([id]);
    }
    const layer = this.doc.layers.find((value) => value.id === id);
    if (!layer || layer.locked) return;
    const point = this.docPoint(event);
    this.drag = {
      type: "move",
      historyPushed: false,
      start: point,
      layers: this.selection
        .map((sid) => this.doc.layers.find((l) => l.id === sid))
        .filter((l) => l && !l.locked)
        .map((l) => ({ layer: l, x: l.x, y: l.y })),
      moved: false,
    };
  }

  handleOverlayDown(event) {
    const handle = event.target.closest?.(".sel-handle");
    if (!handle || this.selection.length !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = this.getSelection()[0];
    if (!layer || layer.locked) return;
    const point = this.docPoint(event);
    this.drag = {
      type: handle.dataset.h === "rot" ? "rotate" : "resize",
      historyPushed: false,
      handle: handle.dataset.h,
      start: point,
      layer,
      origin: { x: layer.x, y: layer.y, w: layer.w, h: layer.h, rotation: layer.rotation || 0 },
      moved: false,
    };
  }

  handlePointerMove(event) {
    if (!this.drag) return;
    const point = this.docPoint(event);
    const dx = point.x - this.drag.start.x;
    const dy = point.y - this.drag.start.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      this.drag.moved = true;
      if (!this.drag.historyPushed) {
        this.pushHistory();
        this.drag.historyPushed = true;
      }
    }

    if (this.drag.type === "move") {
      this.handleMove(dx, dy, event);
    } else if (this.drag.type === "resize") {
      this.handleResize(dx, dy, event);
    } else if (this.drag.type === "rotate") {
      this.handleRotate(point, event);
    }
  }

  handleMove(dx, dy, event) {
    let moveX = dx;
    let moveY = dy;
    this.clearGuides();

    if (!event.altKey && this.drag.layers.length === 1) {
      const { layer, x, y } = this.drag.layers[0];
      const snapped = this.snapPosition(
        { x: x + dx, y: y + dy, w: layer.w, h: layer.h },
        layer.id
      );
      moveX = snapped.x - x;
      moveY = snapped.y - y;
      this.drawGuides(snapped.guides);
    }

    for (const item of this.drag.layers) {
      item.layer.x = Math.round(item.x + moveX);
      item.layer.y = Math.round(item.y + moveY);
      this.applyLayer(item.layer);
    }
    this.renderOverlay();
  }

  handleResize(dx, dy, event) {
    const { handle, origin, layer } = this.drag;
    let { x, y, w, h } = origin;
    if (handle.includes("e")) w = origin.w + dx;
    if (handle.includes("s")) h = origin.h + dy;
    if (handle.includes("w")) {
      w = origin.w - dx;
      x = origin.x + dx;
    }
    if (handle.includes("n")) {
      h = origin.h - dy;
      y = origin.y + dy;
    }
    if (event.shiftKey && handle.length === 2) {
      const ratio = origin.w / origin.h;
      if (w / h > ratio) w = h * ratio;
      else h = w / ratio;
      if (handle.includes("w")) x = origin.x + origin.w - w;
      if (handle.includes("n")) y = origin.y + origin.h - h;
    }
    if (w < MIN_SIZE) {
      if (handle.includes("w")) x = origin.x + origin.w - MIN_SIZE;
      w = MIN_SIZE;
    }
    if (h < MIN_SIZE) {
      if (handle.includes("n")) y = origin.y + origin.h - MIN_SIZE;
      h = MIN_SIZE;
    }
    layer.x = Math.round(x);
    layer.y = Math.round(y);
    layer.w = Math.round(w);
    layer.h = Math.round(h);
    this.applyLayer(layer);
    this.renderOverlay();
  }

  handleRotate(point, event) {
    const { origin, layer } = this.drag;
    const cx = origin.x + origin.w / 2;
    const cy = origin.y + origin.h / 2;
    let angle = (Math.atan2(point.y - cy, point.x - cx) * 180) / Math.PI + 90;
    if (event.shiftKey) angle = Math.round(angle / 15) * 15;
    layer.rotation = Math.round(angle * 10) / 10;
    this.applyLayer(layer);
    this.renderOverlay();
  }

  handlePointerUp() {
    if (!this.drag) return;
    const changed = this.drag.moved;
    this.drag = null;
    this.clearGuides();
    if (changed) this.onChange();
  }

  handleDoubleClick(event) {
    const layerEl = event.target.closest?.(".canvas-layer.text");
    if (!layerEl) return;
    const id = layerEl.dataset.layerId;
    const layer = this.doc.layers.find((value) => value.id === id);
    if (!layer || layer.locked) return;
    const span = layerEl.querySelector("[data-text-span]");
    if (!span) return;
    event.preventDefault();
    this.select([id]);
    span.style.pointerEvents = "auto";
    span.contentEditable = "true";
    span.style.outline = "none";
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    this.editing = { layer, span, before: layer.text };

    const finish = () => {
      span.contentEditable = "false";
      span.style.pointerEvents = "none";
      span.removeEventListener("blur", finish);
      span.removeEventListener("keydown", onKey);
      this.editing = null;
      const text = span.innerText.replace(/\n$/, "");
      if (text !== this.editingBefore && text !== layer.text) {
        this.pushHistory();
      }
      layer.text = text;
      this.render();
      this.onChange();
    };
    const onKey = (keyEvent) => {
      if (keyEvent.key === "Escape") {
        span.blur();
      }
    };
    this.editingBefore = layer.text;
    span.addEventListener("blur", finish);
    span.addEventListener("keydown", onKey);
  }

  snapPosition(box, ignoreId) {
    const candidatesX = [0, this.doc.width / 2, this.doc.width];
    const candidatesY = [0, this.doc.height / 2, this.doc.height];
    for (const layer of this.doc.layers) {
      if (layer.id === ignoreId || layer.hidden) continue;
      candidatesX.push(layer.x, layer.x + layer.w / 2, layer.x + layer.w);
      candidatesY.push(layer.y, layer.y + layer.h / 2, layer.y + layer.h);
    }
    const threshold = SNAP / this.scale;
    let bestX = null;
    let bestY = null;
    const guides = [];
    for (const x of candidatesX) {
      for (const offset of [0, box.w / 2, box.w]) {
        const diff = Math.abs(box.x + offset - x);
        if (diff <= threshold && (!bestX || diff < bestX.diff)) {
          bestX = { diff, value: x, offset };
        }
      }
    }
    for (const y of candidatesY) {
      for (const offset of [0, box.h / 2, box.h]) {
        const diff = Math.abs(box.y + offset - y);
        if (diff <= threshold && (!bestY || diff < bestY.diff)) {
          bestY = { diff, value: y, offset };
        }
      }
    }
    let x = box.x;
    let y = box.y;
    if (bestX) {
      x = bestX.value - bestX.offset;
      guides.push({ axis: "v", at: bestX.value });
    }
    if (bestY) {
      y = bestY.value - bestY.offset;
      guides.push({ axis: "h", at: bestY.value });
    }
    return { x, y, guides };
  }

  drawGuides(guides) {
    this.clearGuides();
    for (const guide of guides || []) {
      const line = document.createElement("div");
      line.className = `guide ${guide.axis}`;
      if (guide.axis === "v") line.style.left = `${guide.at}px`;
      else line.style.top = `${guide.at}px`;
      line.style.opacity = "0.9";
      this.guides.appendChild(line);
    }
  }

  clearGuides() {
    this.guides.innerHTML = "";
  }

  pushHistory() {
    if (!this.doc) return;
    this.history.push(JSON.stringify(this.doc));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
  }

  undo() {
    if (!this.history.length || !this.doc) return;
    this.future.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.history.pop());
    this.selection = [];
    this.render();
    this.onSelection(this.selection);
    this.onChange();
  }

  redo() {
    if (!this.future.length || !this.doc) return;
    this.history.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.future.pop());
    this.selection = [];
    this.render();
    this.onSelection(this.selection);
    this.onChange();
  }

  addLayer(layer) {
    this.pushHistory();
    this.doc.layers.push(layer);
    this.render();
    this.select([layer.id]);
    this.onChange();
  }

  updateLayer(id, patch, { history = true } = {}) {
    const layer = this.doc.layers.find((value) => value.id === id);
    if (!layer) return;
    if (history) this.pushHistory();
    if (patch.x !== undefined) layer.x = Number(patch.x) || 0;
    if (patch.y !== undefined) layer.y = Number(patch.y) || 0;
    if (patch.w !== undefined) layer.w = Math.max(MIN_SIZE, Number(patch.w) || MIN_SIZE);
    if (patch.h !== undefined) layer.h = Math.max(MIN_SIZE, Number(patch.h) || MIN_SIZE);
    if (patch.rotation !== undefined) layer.rotation = Number(patch.rotation) || 0;
    if (patch.opacity !== undefined) layer.opacity = Math.max(0, Math.min(1, Number(patch.opacity)));
    if (patch.name !== undefined) layer.name = String(patch.name);
    if (patch.locked !== undefined) layer.locked = Boolean(patch.locked);
    if (patch.hidden !== undefined) layer.hidden = Boolean(patch.hidden);
    if (patch.text !== undefined) layer.text = String(patch.text);
    if (patch.src !== undefined) layer.src = String(patch.src);
    if (patch.fit !== undefined) layer.fit = patch.fit;
    if (patch.radius !== undefined) layer.radius = Number(patch.radius) || 0;
    if (patch.shape !== undefined) layer.shape = patch.shape;
    if (patch.fill !== undefined) layer.fill = patch.fill;
    if (patch.stroke !== undefined) layer.stroke = patch.stroke;
    if (patch.strokeWidth !== undefined) layer.strokeWidth = Number(patch.strokeWidth) || 0;
    if (patch.style) {
      layer.style = { ...layer.style, ...patch.style };
    }
    this.render();
    this.onChange();
  }

  deleteSelection() {
    if (!this.selection.length) return;
    this.pushHistory();
    this.doc.layers = this.doc.layers.filter((layer) => !this.selection.includes(layer.id));
    this.selection = [];
    this.render();
    this.onSelection(this.selection);
    this.onChange();
  }

  duplicateSelection() {
    if (!this.selection.length) return;
    this.pushHistory();
    const created = [];
    for (const layer of this.getSelection()) {
      const clone = JSON.parse(JSON.stringify(layer));
      clone.id = `layer-${crypto.randomUUID()}`;
      clone.name = `${layer.name} copie`;
      clone.x += 24;
      clone.y += 24;
      this.doc.layers.push(clone);
      created.push(clone.id);
    }
    this.render();
    this.select(created);
    this.onChange();
  }

  groupSelection() {
    if (this.selection.length < 2) return;
    this.pushHistory();
    const groupId = `group-${crypto.randomUUID().slice(0, 8)}`;
    for (const layer of this.getSelection()) layer.groupId = groupId;
    this.render();
    this.onChange();
  }

  ungroupSelection() {
    if (!this.selection.length) return;
    this.pushHistory();
    for (const layer of this.getSelection()) layer.groupId = null;
    this.render();
    this.onChange();
  }

  bringForward() {
    if (!this.selection.length) return;
    this.pushHistory();
    const layers = this.doc.layers;
    for (let i = layers.length - 2; i >= 0; i--) {
      if (this.selection.includes(layers[i].id) && !this.selection.includes(layers[i + 1].id)) {
        [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]];
      }
    }
    this.render();
    this.onChange();
  }

  sendBackward() {
    if (!this.selection.length) return;
    this.pushHistory();
    const layers = this.doc.layers;
    for (let i = 1; i < layers.length; i++) {
      if (this.selection.includes(layers[i].id) && !this.selection.includes(layers[i - 1].id)) {
        [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]];
      }
    }
    this.render();
    this.onChange();
  }
}
