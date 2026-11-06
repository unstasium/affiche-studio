import { normalizeLayer } from "./render.js";

const PALETTES = {
  noir: ["#0b0b0e", "#f3f3fc", "#cd4c51", "#843537", "#8a8a94"],
  violet: ["#12081f", "#f5f0ff", "#7c3aed", "#4c1d95", "#a78bfa"],
  ocean: ["#07131c", "#eaf6ff", "#38bdf8", "#0c4a6e", "#7dd3fc"],
  foret: ["#0a120d", "#f0fdf4", "#22c55e", "#14532d", "#86efac"],
  sable: ["#f3ead8", "#241c12", "#c2703d", "#7c2d12", "#a8896a"],
  neon: ["#0a0a0a", "#f7f7ff", "#8b5cf6", "#ec4899", "#22d3ee"],
};

export const PALETTE_PRESETS = Object.entries(PALETTES).map(([id, colors]) => ({ id, colors }));

const TEXT = {
  fr: {
    dropTitle: "DROP 01",
    dropSub: "Collection capsule",
    dropFoot: "Édition limitée — 2026",
    eventTitle: "SOIRÉE",
    eventSub: "Rendez-vous au studio",
    eventDate: "VEN. 21 NOV. · 19H",
    eventPlace: "AMIENS · FRANCE",
    eventCta: "Entrée libre",
    promoTicket: "-30%",
    promoTitle: "SOLDES",
    promoSub: "Sur toute la collection",
    promoFoot: "Jusqu'au 30 novembre",
    editKicker: "LE JOURNAL",
    editTitle: "L'art de faire moins, mieux.",
    editBody: "Une sélection de pièces pensées pour durer, dessinées à Amiens.",
    editFoot: "UNIMAKERS — NUMÉRO 01",
  },
  en: {
    dropTitle: "DROP 01",
    dropSub: "Capsule collection",
    dropFoot: "Limited edition — 2026",
    eventTitle: "THE NIGHT",
    eventSub: "Meet us at the studio",
    eventDate: "FRI. NOV 21 · 7PM",
    eventPlace: "AMIENS · FRANCE",
    eventCta: "Free entry",
    promoTicket: "-30%",
    promoTitle: "SALE",
    promoSub: "On the whole collection",
    promoFoot: "Until November 30",
    editKicker: "THE JOURNAL",
    editTitle: "The art of doing less, better.",
    editBody: "A selection of pieces made to last, drawn in Amiens.",
    editFoot: "UNIMAKERS — ISSUE 01",
  },
  es: {
    dropTitle: "DROP 01",
    dropSub: "Colección cápsula",
    dropFoot: "Edición limitada — 2026",
    eventTitle: "LA NOCHE",
    eventSub: "Nos vemos en el estudio",
    eventDate: "VIE. 21 NOV · 19H",
    eventPlace: "AMIENS · FRANCIA",
    eventCta: "Entrada libre",
    promoTicket: "-30%",
    promoTitle: "REBAJAS",
    promoSub: "En toda la colección",
    promoFoot: "Hasta el 30 de noviembre",
    editKicker: "EL DIARIO",
    editTitle: "El arte de hacer menos, mejor.",
    editBody: "Una selección de piezas pensadas para durar, dibujadas en Amiens.",
    editFoot: "UNIMAKERS — NÚMERO 01",
  },
};

function text(id, name, value, x, y, w, h, opts = {}) {
  const layer = normalizeLayer({
    id,
    type: "text",
    name,
    text: value,
    x, y, w, h,
    style: {
      fontFamily: "Inter",
      fontSize: 30,
      fontWeight: 600,
      color: "#f3f3fc",
      align: "left",
      valign: "top",
      lineHeight: 1.2,
      letterSpacing: 0,
      textTransform: "none",
      ...opts,
    },
  });
  return layer;
}

function shape(id, name, value, x, y, w, h, fill, extra = {}) {
  return normalizeLayer({
    id,
    type: "shape",
    name,
    shape: value,
    x, y, w, h,
    fill,
    ...extra,
  });
}

function build(kind, lang, palette) {
  const t = TEXT[lang] || TEXT.fr;
  const p = palette || PALETTES.noir;
  const [bg, fg, accent, deep, grey] = p;

  if (kind === "drop") {
    return {
      background: bg,
      palette: p,
      layers: [
        shape("s1", "Halo", "ellipse", 540, 540, 900, 900, accent, { opacity: 0.16 }),
        text("t1", "Kicker", "UNIMAKERS · AMIENS", 72, 96, 700, 40, { fontSize: 20, letterSpacing: 6, color: grey, textTransform: "uppercase" }),
        text("t2", "Titre", t.dropTitle, 64, 190, 960, 260, { fontFamily: "Anton", fontSize: 210, lineHeight: 0.86, color: fg, textTransform: "uppercase" }),
        text("t3", "Sous-titre", t.dropSub, 72, 470, 600, 50, { fontSize: 30, color: accent, fontWeight: 500 }),
        shape("s2", "Cadre produit", "rect", 96, 640, 888, 800, "rgba(255,255,255,.04)", { radius: 28, stroke: grey, strokeWidth: 2 }),
        text("t4", "Produit", "VOTRE VISUEL", 96, 1000, 888, 40, { fontSize: 22, align: "center", color: grey, letterSpacing: 4, textTransform: "uppercase" }),
        shape("s3", "Barre", "rect", 72, 1560, 936, 3, accent),
        text("t5", "Pied", t.dropFoot, 72, 1600, 600, 40, { fontSize: 22, color: grey }),
        text("t6", "Prix", "45€", 760, 1580, 250, 90, { fontFamily: "Anton", fontSize: 76, align: "right", color: fg }),
        shape("s4", "Badge", "ellipse", 830, 90, 170, 170, accent),
        text("t7", "Badge texte", "01", 830, 132, 170, 80, { fontFamily: "Anton", fontSize: 64, align: "center", color: "#fff" }),
      ],
    };
  }

  if (kind === "event") {
    return {
      background: bg,
      palette: p,
      layers: [
        shape("e1", "Bande", "rect", 0, 0, 1080, 280, accent),
        text("e2", "Kicker", "UNIMAKERS PRÉSENTE", 64, 60, 700, 40, { fontSize: 20, letterSpacing: 6, color: "#fff", textTransform: "uppercase" }),
        text("e3", "Titre", t.eventTitle, 56, 340, 968, 220, { fontFamily: "Anton", fontSize: 200, lineHeight: 0.9, color: deep, textTransform: "uppercase" }),
        text("e4", "Sous-titre", t.eventSub, 64, 600, 700, 60, { fontSize: 34, color: deep, fontWeight: 500 }),
        shape("e5", "Ligne", "rect", 64, 720, 952, 2, deep, { opacity: 0.3 }),
        text("e6", "Date", t.eventDate, 64, 780, 600, 90, { fontFamily: "Archivo Black", fontSize: 46, color: accent }),
        text("e7", "Lieu", t.eventPlace, 64, 890, 600, 50, { fontSize: 28, letterSpacing: 3, color: deep }),
        shape("e8", "Cercle", "ellipse", 760, 760, 240, 240, accent),
        text("e9", "Cta", t.eventCta, 760, 850, 240, 60, { fontSize: 26, align: "center", color: "#fff", fontWeight: 700 }),
        text("e10", "Pied", t.editFoot, 64, 1800, 700, 40, { fontSize: 18, letterSpacing: 4, color: deep, opacity: 0.6 }),
      ],
    };
  }

  if (kind === "promo") {
    return {
      background: bg,
      palette: p,
      layers: [
        shape("p1", "Cercle", "ellipse", 620, 90, 380, 380, fg, { opacity: 0.08 }),
        text("p2", "Kicker", "OFFRE LIMITÉE", 64, 80, 500, 40, { fontSize: 20, letterSpacing: 6, color: grey, textTransform: "uppercase" }),
        text("p3", "Promo", t.promoTicket, 48, 170, 990, 340, { fontFamily: "Anton", fontSize: 320, lineHeight: 0.85, color: deep, textTransform: "uppercase" }),
        text("p4", "Titre", t.promoTitle, 64, 520, 700, 120, { fontFamily: "Archivo Black", fontSize: 64, color: fg, textTransform: "uppercase" }),
        text("p5", "Sous-titre", t.promoSub, 64, 660, 700, 60, { fontSize: 30, color: deep, fontWeight: 500 }),
        shape("p6", "Cadre", "rect", 64, 800, 952, 720, "rgba(255,255,255,.18)", { radius: 24, stroke: fg, strokeWidth: 2 }),
        text("p7", "Visuel", "VOTRE VISUEL", 64, 1120, 952, 40, { fontSize: 22, align: "center", color: deep, letterSpacing: 4, textTransform: "uppercase" }),
        shape("p8", "Bandeau", "rect", 0, 1640, 1080, 160, deep),
        text("p9", "Pied", t.promoFoot, 64, 1690, 700, 60, { fontSize: 28, color: "#fff", fontWeight: 600 }),
        text("p10", "Cta", "→", 920, 1680, 100, 70, { fontFamily: "Anton", fontSize: 54, align: "right", color: "#fff" }),
      ],
    };
  }

  // editorial
  return {
    background: bg,
    palette: p,
    layers: [
      shape("m1", "Bande", "rect", 0, 0, 1080, 26, accent),
      text("m2", "Kicker", t.editKicker, 72, 90, 700, 40, { fontSize: 20, letterSpacing: 7, color: accent, textTransform: "uppercase" }),
      text("m3", "Titre", t.editTitle, 64, 190, 900, 330, { fontFamily: "Instrument Serif", fontSize: 112, lineHeight: 1.02, color: deep }),
      shape("m4", "Filet", "rect", 72, 580, 200, 4, accent),
      text("m5", "Corps", t.editBody, 72, 630, 560, 200, { fontSize: 28, lineHeight: 1.6, color: deep, opacity: 0.8 }),
      shape("m6", "Visuel", "rect", 72, 900, 936, 740, accent, { opacity: 0.16, radius: 4 }),
      text("m7", "Légende", "VOTRE VISUEL", 72, 1240, 936, 40, { fontSize: 20, align: "center", letterSpacing: 5, color: deep, textTransform: "uppercase", opacity: 0.55 }),
      text("m8", "Pied", t.editFoot, 72, 1780, 700, 40, { fontSize: 18, letterSpacing: 4, color: deep, opacity: 0.55 }),
    ],
  };
}

export const TEMPLATES = [
  { id: "drop", nameKey: "templateDrop", descKey: "templateDropDesc" },
  { id: "event", nameKey: "templateEvent", descKey: "templateEventDesc" },
  { id: "promo", nameKey: "templatePromo", descKey: "templatePromoDesc" },
  { id: "editorial", nameKey: "templateEditorial", descKey: "templateEditorialDesc" },
];

export function buildTemplate(id, lang = "fr", palette) {
  return build(id, lang, palette);
}
