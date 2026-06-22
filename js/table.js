import { t, pickLangField, getLang } from "./i18n.js";

const fmtInt = (n) => Number(n).toLocaleString();

function sortableTable(el, cols, rows, { initialSort, initialDir = "desc" } = {}) {
  let sortKey = initialSort ?? cols[0].key;
  let dir = initialDir;

  function render() {
    const sorted = [...rows].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb : String(va).localeCompare(String(vb), getLang());
      return dir === "asc" ? cmp : -cmp;
    });
    const thead = `<thead><tr>${cols.map((c) =>
      `<th data-k="${c.key}">${c.label()}${sortKey === c.key ? (dir === "asc" ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${sorted.map((r) =>
      `<tr>${cols.map((c) => `<td>${c.cell(r)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    el.innerHTML = thead + tbody;
    el.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k;
      if (k === sortKey) dir = dir === "asc" ? "desc" : "asc";
      else { sortKey = k; dir = "desc"; }
      render();
    }));
  }
  render();
}

export function nationalTable(el, national) {
  const statusLabel = { government: t("status_government"), opposition: t("status_opposition"), "below-threshold": t("status_below") };
  const statusClass = { government: "gov", opposition: "opp", "below-threshold": "below" };
  const cols = [
    { key: "name", label: () => t("table_party"),
      cell: (r) => `<span class="swatch" style="background:${r.color}"></span>${pickLangField(r, "name")}` },
    { key: "votes", label: () => t("table_votes"), cell: (r) => `<span class="tabnum">${fmtInt(r.votes)}</span>` },
    { key: "pct", label: () => t("table_pct"), cell: (r) => `<span class="tabnum">${r.pct.toFixed(2)}</span>` },
    { key: "seats", label: () => t("table_seats"), cell: (r) => `<span class="tabnum">${r.seats || "—"}</span>` },
    { key: "bloc", label: () => t("table_status"),
      cell: (r) => `<span class="pill ${statusClass[r.bloc]}">${statusLabel[r.bloc]}</span>` },
    { key: "leader", label: () => t("table_leader"), cell: (r) => r.leader || "—" },
  ];
  sortableTable(el, cols, national.parties, { initialSort: "votes" });
}

export function explorerTable(el, rows, level, partiesMeta, search = "") {
  const partyCols = ["civil_contract", "strong_armenia", "armenia_alliance"];
  const meta = Object.fromEntries(partiesMeta.map((p) => [p.id, p]));
  const nameOf = (id) => meta[id]?.abbr?.split(" / ")[1] || id;

  const q = search.trim().toLowerCase();
  let data = rows;
  if (q) data = rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q)));

  const firstLabel = level === "marz" ? t("nav_map") : t("data_level");
  const cols = [
    { key: level === "marz" ? "name" : "community_hy", label: () => firstLabel,
      cell: (r) => r._name || r.community_hy || r.marz_en },
    { key: "marz_en", label: () => "Marz", cell: (r) => r.marz_en, hide: level === "marz" },
    { key: "registered", label: () => t("panel_registered"), cell: (r) => `<span class="tabnum">${fmtInt(r.registered)}</span>` },
    { key: "turnout_pct", label: () => t("panel_turnout"), cell: (r) => `<span class="tabnum">${(+r.turnout_pct).toFixed(1)}%</span>` },
    ...partyCols.map((pid) => ({
      key: pid, label: () => nameOf(pid),
      cell: (r) => {
        const pct = r.valid ? (100 * (r[pid] || 0) / r.valid) : 0;
        return `<span class="tabnum">${pct.toFixed(1)}%</span>`;
      },
    })),
  ].filter((c) => !c.hide);

  sortableTable(el, cols, data, { initialSort: "registered" });
}
