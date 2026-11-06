const CACHE = new Map();
let current = "fr";
let dict = {};

export async function setLanguage(lang) {
  current = ["fr", "en", "es"].includes(lang) ? lang : "fr";
  if (!CACHE.has(current)) {
    const response = await fetch(`locales/${current}.json`);
    CACHE.set(current, await response.json());
  }
  dict = CACHE.get(current);
  document.documentElement.lang = current;
  applyStatic();
  return dict;
}

export function t(key, vars = {}) {
  let value = dict[key] ?? key;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

export function getLanguage() {
  return current;
}

export function applyStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}
