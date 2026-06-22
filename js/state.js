// Shareable URL state. Everything that changes the visual is encoded in the query
// string, so any view can be copied and exchanged as a plain link.

const DEFAULTS = {
  lang: "en",
  view: "margin",      // winner | margin | turnout | party
  party: "civil_contract",
  marz: "",            // selected province iso, e.g. AM-ER
  level: "marz",       // data explorer level: marz | communities
};

const listeners = new Set();
let state = { ...DEFAULTS };

export function initState() {
  const q = new URLSearchParams(location.search);
  for (const k of Object.keys(DEFAULTS)) {
    if (q.has(k)) state[k] = q.get(k);
  }
  // language can also come from the browser on first visit
  if (!q.has("lang")) {
    const nav = (navigator.language || "en").slice(0, 2);
    if (["en", "hy", "fr"].includes(nav)) state.lang = nav;
  }
  return getState();
}

export function getState() { return { ...state }; }

export function setState(patch, { push = false, silent = false } = {}) {
  const next = { ...state, ...patch };
  let changed = false;
  for (const k of Object.keys(next)) if (next[k] !== state[k]) changed = true;
  if (!changed) return;
  state = next;
  syncURL(push);
  if (!silent) listeners.forEach((fn) => fn(getState(), patch));
}

function syncURL(push) {
  const q = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS)) {
    if (state[k] && state[k] !== DEFAULTS[k]) q.set(k, state[k]);
  }
  const url = location.pathname + (q.toString() ? "?" + q.toString() : "") + location.hash;
  (push ? history.pushState : history.replaceState).call(history, null, "", url);
}

export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function shareURL() {
  const q = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS)) if (state[k]) q.set(k, state[k]);
  return location.origin + location.pathname + "?" + q.toString() + location.hash;
}

window.addEventListener("popstate", () => {
  const q = new URLSearchParams(location.search);
  const next = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (q.has(k)) next[k] = q.get(k);
  state = next;
  listeners.forEach((fn) => fn(getState(), next));
});
