export const FONTS = [
  { id: "Anton", label: "Anton", stack: "'Anton', 'Arial Narrow', sans-serif", display: true },
  { id: "Archivo Black", label: "Archivo Black", stack: "'Archivo Black', Impact, sans-serif", display: true },
  { id: "Bebas Neue", label: "Bebas Neue", stack: "'Bebas Neue', 'Arial Narrow', sans-serif", display: true },
  { id: "Oswald", label: "Oswald", stack: "'Oswald', 'Arial Narrow', sans-serif", display: true },
  { id: "Inter", label: "Inter", stack: "'Inter', system-ui, sans-serif" },
  { id: "DM Sans", label: "DM Sans", stack: "'DM Sans', system-ui, sans-serif" },
  { id: "Space Grotesk", label: "Space Grotesk", stack: "'Space Grotesk', system-ui, sans-serif" },
  { id: "Manrope", label: "Manrope", stack: "'Manrope', system-ui, sans-serif" },
  { id: "Instrument Serif", label: "Instrument Serif", stack: "'Instrument Serif', Georgia, serif" },
  { id: "Playfair Display", label: "Playfair Display", stack: "'Playfair Display', Georgia, serif" },
  { id: "Libre Baskerville", label: "Libre Baskerville", stack: "'Libre Baskerville', Georgia, serif" },
  { id: "JetBrains Mono", label: "JetBrains Mono", stack: "'JetBrains Mono', monospace" },
];

const STACKS = Object.fromEntries(FONTS.map((f) => [f.id, f.stack]));

export function fontStack(id) {
  return STACKS[id] || STACKS.Inter;
}

export function assignedIds(layers = []) {
  return layers.map((layer) => layer.id);
}

export function valignToFlex(value) {
  if (value === "middle") return "center";
  if (value === "bottom") return "flex-end";
  return "flex-start";
}

export function normalizeLayer(layer, index = 0) {
  const base = {
    id: layer.id || `layer-${crypto.randomUUID()}`,
    type: layer.type || "text",
    name: layer.name || `Calque ${index + 1}`,
    x: Number(layer.x) || 0,
    y: Number(layer.y) || 0,
    w: Math.max(8, Number(layer.w) || 200),
    h: Math.max(8, Number(layer.h) || 80),
    rotation: Number(layer.rotation) || 0,
    opacity: layer.opacity === undefined ? 1 : Number(layer.opacity),
    locked: Boolean(layer.locked),
    hidden: Boolean(layer.hidden),
    groupId: layer.groupId || null,
    text: layer.text || "",
    src: layer.src || "",
    fit: layer.fit === "cover" ? "cover" : "contain",
    radius: Number(layer.radius) || 0,
    shape: ["rect", "ellipse", "line"].includes(layer.shape) ? layer.shape : "rect",
    fill: layer.fill || "#cd4c51",
    stroke: layer.stroke || "",
    strokeWidth: Number(layer.strokeWidth) || 0,
    style: {
      fontFamily: layer.style?.fontFamily || "Inter",
      fontSize: Number(layer.style?.fontSize) || 32,
      fontWeight: Number(layer.style?.fontWeight) || 600,
      fontStyle: layer.style?.fontStyle === "italic" ? "italic" : "normal",
      color: layer.style?.color || "#f3f3fc",
      align: ["left", "center", "right", "justify"].includes(layer.style?.align) ? layer.style.align : "left",
      valign: ["top", "middle", "bottom"].includes(layer.style?.valign) ? layer.style.valign : "top",
      lineHeight: Number(layer.style?.lineHeight) || 1.2,
      letterSpacing: Number(layer.style?.letterSpacing) || 0,
      textTransform: ["none", "uppercase", "lowercase", "capitalize"].includes(layer.style?.textTransform)
        ? layer.style.textTransform
        : "none",
      padding: Number(layer.style?.padding) || 0,
      background: layer.style?.background || "",
      radius: Number(layer.style?.radius) || 0,
    },
  };
  return base;
}

export function layerCss(layer) {
  const css = {
    position: "absolute",
    left: `${layer.x}px`,
    top: `${layer.y}px`,
    width: `${layer.w}px`,
    height: `${layer.h}px`,
    transform: `rotate(${layer.rotation || 0}deg)`,
    opacity: layer.opacity ?? 1,
    zIndex: 1,
  };
  if (layer.hidden) css.display = "none";
  if (layer.type === "text") {
    css.fontFamily = fontStack(layer.style.fontFamily);
    css.fontSize = `${layer.style.fontSize}px`;
    css.fontWeight = layer.style.fontWeight;
    css.fontStyle = layer.style.fontStyle;
    css.color = layer.style.color;
    css.textAlign = layer.style.align;
    css.lineHeight = layer.style.lineHeight;
    css.letterSpacing = `${layer.style.letterSpacing}px`;
    css.textTransform = layer.style.textTransform;
    css.padding = `${layer.style.padding}px`;
    css.display = "flex";
    css.alignItems = valignToFlex(layer.style.valign);
    css.whiteSpace = "pre-wrap";
    css.wordBreak = "break-word";
    css.overflow = "visible";
    if (layer.style.background) {
      css.background = layer.style.background;
      css.borderRadius = `${layer.style.radius}px`;
    }
    return css;
  }
  if (layer.type === "image") {
    css.overflow = "hidden";
    css.borderRadius = `${layer.radius}px`;
    return css;
  }
  css.background = layer.shape === "line" ? layer.fill : layer.fill;
  css.borderRadius =
    layer.shape === "ellipse" ? "50%" : layer.shape === "line" ? "999px" : `${layer.radius}px`;
  if (layer.shape === "line") {
    css.height = `${Math.max(2, layer.strokeWidth || 4)}px`;
  }
  if (layer.stroke && layer.strokeWidth > 0) {
    css.border = `${layer.strokeWidth}px solid ${layer.stroke}`;
  }
  return css;
}

function applyCss(el, css) {
  for (const [key, value] of Object.entries(css)) {
    if (value !== undefined && value !== null) el.style[key] = value;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function assetUrl(assets, name) {
  if (Array.isArray(assets)) {
    return assets.find((a) => a.name === name)?.dataUrl || "";
  }
  return assets?.[name] || "";
}

export function createLayerElement(layer, assets, { editor = false } = {}) {
  const el = document.createElement("div");
  el.className = `canvas-layer ${layer.type}`;
  if (editor) {
    el.dataset.layerId = layer.id;
    el.style.pointerEvents = layer.locked || layer.hidden ? "none" : "auto";
    el.style.cursor = layer.locked ? "default" : "move";
    el.style.userSelect = "none";
  }
  applyCss(el, layerCss(layer));

  if (layer.type === "text") {
    const span = document.createElement("span");
    span.style.width = "100%";
    span.textContent = layer.text;
    if (editor) {
      span.style.pointerEvents = "none";
      span.dataset.textSpan = "1";
    }
    el.appendChild(span);
  } else if (layer.type === "image") {
    const img = document.createElement("img");
    img.src = assetUrl(assets, layer.src);
    img.alt = layer.name;
    img.draggable = false;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = layer.fit;
    img.style.display = "block";
    if (!img.src) {
      img.style.visibility = "hidden";
      el.style.background = "rgba(120,120,140,.18)";
      el.style.border = "1px dashed rgba(120,120,140,.5)";
    }
    el.appendChild(img);
  }
  return el;
}

export function renderDocument(doc, assets, { editor = false } = {}) {
  const canvas = document.createElement("div");
  canvas.className = "canvas";
  canvas.style.position = "relative";
  canvas.style.width = `${doc.width}px`;
  canvas.style.height = `${doc.height}px`;
  canvas.style.background = doc.background || "#0b0b0e";
  canvas.style.overflow = "hidden";
  canvas.style.flex = "none";
  for (const layer of doc.layers || []) {
    canvas.appendChild(createLayerElement(layer, assets, { editor }));
  }
  return canvas;
}

function layerToHtml(layer, assets) {
  const css = layerCss(layer);
  const style = Object.entries(css)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${value}`)
    .join(";");
  if (layer.type === "text") {
    return `<div style="${style}"><span style="width:100%">${escapeHtml(layer.text)}</span></div>`;
  }
  if (layer.type === "image") {
    const url = assetUrl(assets, layer.src);
    if (!url) return "";
    return `<div style="${style}"><img src="${url}" alt="${escapeHtml(layer.name)}" style="width:100%;height:100%;object-fit:${layer.fit};display:block"/></div>`;
  }
  return `<div style="${style}"></div>`;
}

export function documentToHtml(doc, assets, extraFontCss = "") {
  const layers = (doc.layers || []).map((layer) => layerToHtml(layer, assets)).join("\n");
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.name || "Affiche")}</title>
<style>
${extraFontCss}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent}
@page{size:${doc.width}px ${doc.height}px;margin:0}
.canvas{position:relative;width:${doc.width}px;height:${doc.height}px;overflow:hidden;background:${doc.background || "#0b0b0e"}}
</style>
</head>
<body>
<div class="canvas">
${layers}
</div>
</body>
</html>`;
}

export function templateThumb(doc, assets) {
  const scale = Math.min(150 / doc.width, 190 / doc.height);
  const node = renderDocument(doc, assets);
  node.style.transform = `scale(${scale})`;
  node.style.transformOrigin = "top left";
  const wrap = document.createElement("div");
  wrap.className = "mini";
  wrap.style.width = `${doc.width * scale}px`;
  wrap.style.height = `${doc.height * scale}px`;
  wrap.style.overflow = "hidden";
  wrap.style.position = "relative";
  wrap.style.flex = "none";
  node.style.position = "absolute";
  node.style.left = "0";
  node.style.top = "0";
  wrap.appendChild(node);
  return wrap;
}
