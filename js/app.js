import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { STRINGS, LANGS, LANG_LABEL, t, setLang, getLang, pickLangField } from "./i18n.js";
import { loadCore, loadCommunities, loadElections } from "./data.js";
import { initState, getState, setState, onState } from "./state.js";
import { createMap, renderLegend } from "./map.js";
import { voteBars, hemicycle, miniMap, communityMap } from "./charts.js";
import { nationalTable, explorerTable } from "./table.js";

const LEADER_LINK = {
  civil_contract: "leader_pashinyan", strong_armenia: "leader_karapetyan",
  armenia_alliance: "leader_kocharyan", prosperous_armenia: "leader_tsarukyan",
  anc: "leader_ter_petrosyan", bright_armenia: "leader_marukyan",
  hanrapetutyun: "leader_sargsyan", wings_of_unity: "leader_tandilyan",
};

let core, mapApi, communities = null, electionId, electionList = [];
const $ = (s) => document.querySelector(s);
const fmtInt = (n) => Number(n).toLocaleString(getLang() === "hy" ? "hy-AM" : getLang());

init();

async function init() {
  initState();
  const elections = await loadElections();
  electionList = elections.elections || [];
  electionId = elections.default;
  core = await loadCore(electionId);
  rewindGeo(core.geo);
  setLang(getState().lang);

  buildElectionSwitch();
  buildLangSwitch();
  buildThemeToggle();
  applyI18n();

  renderHeroMap();
  renderStats();
  voteBars($("#voteBars"), core.national);
  hemicycle($("#hemicycle"), core.national);
  nationalTable($("#nationalTable"), core.national);

  setupMap();
  buildCommunityMap();
  buildPartyChips();
  renderPartyDetail(getState().party);
  buildMapControls();
  buildDataExplorer();
  renderAbout();
  wireScrollSpy();
  wireTooltipDismiss();
  loadRepoStars();

  onState((s, patch) => {
    if (patch.lang) { setLang(s.lang); applyI18n(); buildElectionSwitch(); refreshAll(); }
    mapApi.render(s);
    renderLegend($("#mapLegend"), mapApi, s);
    syncMapControls(s);
    if (s.marz) renderPanel(s.marz);
    renderPartyDetail(s.party);
  });

  // first paint
  const s = getState();
  mapApi.render(s);
  renderLegend($("#mapLegend"), mapApi, s);
  syncMapControls(s);
  if (s.marz) renderPanel(s.marz);
}

// d3-geo fills the complement of a polygon whose ring winding is reversed
// (it renders as a globe-filling rectangle). Detect via spherical area > 2π and flip.
function rewindGeo(geo) {
  const rev = (poly) => poly.map((ring) => ring.slice().reverse());
  for (const f of geo.features) {
    if (d3.geoArea(f) > 2 * Math.PI) {
      if (f.geometry.type === "Polygon") f.geometry.coordinates = rev(f.geometry.coordinates);
      else if (f.geometry.type === "MultiPolygon") f.geometry.coordinates = f.geometry.coordinates.map(rev);
    }
  }
}

/* ---------------- i18n / chrome ---------------- */
function applyI18n() {
  const lang = getLang();
  document.documentElement.lang = lang;
  document.documentElement.dir = t("dir");
  document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = t(n.dataset.i18n); });
  $("#dataSearch").placeholder = t("data_search");
  document.querySelectorAll("#langswitch button").forEach((b) =>
    b.classList.toggle("active", b.dataset.l === lang));
  $("#footerLicense").textContent = t("about_license");
}

function buildElectionSwitch() {
  const wrap = $("#electionSwitch");
  if (!wrap) return;
  const order = [...electionList].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  wrap.innerHTML = order.map((e) => {
    const available = e.status === "available";
    const cls = available ? "epill active" : "epill soon";
    const label = available ? e.id : `${e.id} · ${t("election_soon")}`;
    const cur = available && e.id === electionId ? ' aria-current="true"' : "";
    const dis = available ? "" : ' aria-disabled="true"';
    return `<span class="${cls}"${cur}${dis}>${label}</span>`;
  }).join("");
}

function buildLangSwitch() {
  const wrap = $("#langswitch");
  wrap.innerHTML = LANGS.map((l) => `<button data-l="${l}">${LANG_LABEL[l]}</button>`).join("");
  wrap.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => setState({ lang: b.dataset.l }, { push: false })));
}

function buildThemeToggle() {
  const saved = localStorage.getItem("atlas-theme");
  if (saved) document.body.dataset.theme = saved;
  $("#themebtn").addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = next;
    localStorage.setItem("atlas-theme", next);
  });
}

function refreshAll() {
  renderStats();
  voteBars($("#voteBars"), core.national);
  hemicycle($("#hemicycle"), core.national);
  nationalTable($("#nationalTable"), core.national);
  buildPartyChips();
  buildMapControls();
  buildCommunityMap();
  renderAbout();
  buildDataExplorer();
}

/* ---------------- hero ---------------- */
function renderHeroMap() {
  const el = $("#heroMap");
  const W = 700, H = 560;
  const proj = d3.geoMercator().fitExtent([[20, 20], [W - 20, H - 20]], core.geo);
  const path = d3.geoPath(proj);
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`);
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", "heroGrad").attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", 1);
  grad.append("stop").attr("offset", "0%").attr("stop-color", "#F2A900");
  grad.append("stop").attr("offset", "100%").attr("stop-color", "#D90012");
  svg.selectAll("path").data(core.geo.features).join("path").attr("d", path)
    .attr("fill", "url(#heroGrad)").attr("stroke", "rgba(255,255,255,.25)").attr("stroke-width", 1)
    .attr("opacity", 0).transition().delay((d, i) => i * 60).duration(500).attr("opacity", .9);
}

function renderStats() {
  const n = core.national;
  const stats = [
    { v: n.turnout_pct + "%", l: t("stat_turnout") },
    { v: n.total_seats, l: t("stat_seats") },
    { v: fmtInt(n.stations), l: t("stat_stations") },
    { v: n.parties.length, l: t("stat_forces") },
  ];
  $("#statgrid").innerHTML = stats.map((s) =>
    `<div class="stat"><div class="v">${s.v}</div><div class="l">${s.l}</div></div>`).join("");
}

/* ---------------- map ---------------- */
function setupMap() {
  mapApi = createMap({
    el: $("#choropleth"), geo: core.geo, marz: core.marz, parties: core.parties,
    onSelect: (iso) => setState({ marz: iso }, { push: true }),
  });
}

function buildMapControls() {
  const modes = [
    ["margin", t("map_mode_margin")], ["winner", t("map_mode_winner")],
    ["turnout", t("map_mode_turnout")], ["party", t("map_mode_party")],
  ];
  $("#mapModes").innerHTML = modes.map(([k, l]) =>
    `<button data-v="${k}">${l}</button>`).join("");
  $("#mapModes").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => setState({ view: b.dataset.v }, { push: false })));

  const sel = $("#partySelect");
  sel.innerHTML = core.parties.map((p) =>
    `<option value="${p.id}">${pickLangField(p, "name")}</option>`).join("");
  sel.addEventListener("change", () => setState({ view: "party", party: sel.value }, { push: false }));
}

function syncMapControls(s) {
  $("#mapModes").querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.v === s.view));
  const sel = $("#partySelect");
  sel.hidden = s.view !== "party";
  sel.value = s.party;
  const note = $("#mapNote");
  if (s.view === "winner") { note.hidden = false; note.textContent = t("map_winner_note"); }
  else note.hidden = true;
}

function renderPanel(iso) {
  const m = core.marz[iso];
  if (!m) return;
  const partyById = Object.fromEntries(core.parties.map((p) => [p.id, p]));
  const name = pickLangField({ name_en: m.name_en, name_hy: m.name_hy, name_fr: m.name_fr }, "name");
  const rows = m.order.filter((pid) => m.shares[pid].pct >= 1).map((pid) => {
    const p = partyById[pid], pct = m.shares[pid].pct;
    return `<div class="barrow"><span class="nm">${pickLangField(p, "name")}</span>
      <span class="track"><span class="fill" style="width:${Math.min(pct * 1.6, 100)}%;background:${p.color}"></span></span>
      <span class="pct">${pct.toFixed(1)}%</span></div>`;
  }).join("");
  $("#marzPanel").innerHTML = `
    <h3 class="panel-name">${name}</h3>
    <div class="panel-stats">
      <div class="ps"><div class="v">${m.turnout_pct}%</div><div class="l">${t("panel_turnout")}</div></div>
      <div class="ps"><div class="v">+${m.margin}</div><div class="l">${t("panel_margin")}</div></div>
      <div class="ps"><div class="v">${fmtInt(m.registered)}</div><div class="l">${t("panel_registered")}</div></div>
      <div class="ps"><div class="v">${fmtInt(m.stations)}</div><div class="l">${t("panel_stations")}</div></div>
    </div>
    <div>${rows}</div>`;
}

/* ---------------- community zoom map ---------------- */
let comMap = null;
function buildCommunityMap() {
  comMap = communityMap({
    el: $("#communityMap"), geo: core.geo, communities: core.communitiesGeo,
    parties: core.parties, lang: getLang(), marzNameFn: marzName,
  });
  $("#zoomIn").onclick = () => comMap.zoomBy(1.6);
  $("#zoomOut").onclick = () => comMap.zoomBy(1 / 1.6);
  $("#zoomReset").onclick = () => comMap.reset();
  // legend: winners present
  const partyById = Object.fromEntries(core.parties.map((p) => [p.id, p]));
  const winners = [...new Set(core.communitiesGeo.map((c) => c.winner))];
  $("#communityLegend").innerHTML = `<div class="swatches">${winners.map((w) =>
    `<span class="sw"><i style="background:${partyById[w].color}"></i>${pickLangField(partyById[w], "name")}</span>`).join("")}</div>`;
  $("#communityHint").textContent = `${t("explore_hint")} · ${core.comCoverage.located}/${core.comCoverage.total} ${t("explore_coverage")}`;
}

/* ---------------- repo star badge ---------------- */
async function loadRepoStars() {
  const el = $("#repoStars .rb-count");
  if (!el) return;
  try {
    const r = await fetch("https://api.github.com/repos/thepriben/armenia-election-atlas");
    if (!r.ok) return;
    const d = await r.json();
    el.textContent = Number(d.stargazers_count || 0).toLocaleString(getLang());
  } catch (e) {}
}

/* ---------------- parties ---------------- */
function buildPartyChips() {
  $("#partyChips").innerHTML = core.parties.map((p) =>
    `<button data-p="${p.id}"><span class="dot" style="background:${p.color}"></span>${pickLangField(p, "name")}</button>`).join("");
  $("#partyChips").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => setState({ party: b.dataset.p }, { push: false })));
}

function renderPartyDetail(pid) {
  const p = core.parties.find((x) => x.id === pid) || core.parties[0];
  document.querySelectorAll("#partyChips button").forEach((b) =>
    b.classList.toggle("active", b.dataset.p === p.id));

  const lang = getLang();
  const prose = (core.profiles[p.id] && (core.profiles[p.id][lang] || core.profiles[p.id].en)) || "";
  const statusLabel = { government: t("status_government"), opposition: t("status_opposition"), "below-threshold": t("status_below") };
  const bestName = core.marz[p.best_marz] ? marzName(p.best_marz) : "—";
  const worstName = core.marz[p.worst_marz] ? marzName(p.worst_marz) : "—";
  const wonNames = p.won_marz.map(marzName).join(", ") || "—";

  const refs = [];
  const pl = core.links[p.id];
  if (pl?.wikipedia?.[lang] || pl?.wikipedia?.en) {
    const w = pl.wikipedia[lang] || pl.wikipedia.en;
    refs.push(`<a href="${w.url}" target="_blank" rel="noopener">Wikipedia ↗</a>`);
  }
  if (pl?.wikidata) refs.push(`<a href="${pl.wikidata}" target="_blank" rel="noopener">Wikidata · ${pl.qid}</a>`);
  const ll = core.links[LEADER_LINK[p.id]];
  if (p.leader && (ll?.wikipedia?.[lang] || ll?.wikipedia?.en)) {
    const w = ll.wikipedia[lang] || ll.wikipedia.en;
    refs.push(`<a href="${w.url}" target="_blank" rel="noopener">${p.leader} ↗</a>`);
  }

  $("#partyDetail").innerHTML = `
    <div class="party-main">
      <div class="party-head">
        <h3 style="color:${p.color}">${pickLangField(p, "name")}</h3>
        <div class="party-names">${p.name_en} · ${p.name_hy} · ${p.name_fr}</div>
      </div>
      <p class="party-prose">${prose}</p>
      <div class="party-meta">
        <div class="row"><span class="k">${t("party_leader")}</span><span>${p.leader || "—"}</span></div>
        <div class="row"><span class="k">${t("party_result")}</span><span>${fmtInt(p.votes)} · ${p.pct.toFixed(2)}% · ${p.seats || 0} ${t("table_seats").toLowerCase()}</span></div>
        <div class="row"><span class="k">${t("party_best")}</span><span>${bestName} (${(p.by_marz[p.best_marz] ?? 0).toFixed(1)}%)</span></div>
        <div class="row"><span class="k">${t("party_worst")}</span><span>${worstName} (${(p.by_marz[p.worst_marz] ?? 0).toFixed(1)}%)</span></div>
        <div class="row"><span class="k">${t("party_won")}</span><span>${wonNames}</span></div>
      </div>
      <div class="reflinks">${refs.join("")}</div>
    </div>
    <div class="minimap"><div class="small muted" style="margin-bottom:6px">${t("legend_share")}</div><div id="partyMini"></div></div>`;
  miniMap($("#partyMini"), core.geo, core.marz, core.parties, p.id);
}

function marzName(iso) {
  const m = core.marz[iso];
  return m ? pickLangField({ name_en: m.name_en, name_hy: m.name_hy, name_fr: m.name_fr }, "name") : iso;
}

/* ---------------- data explorer ---------------- */
function buildDataExplorer() {
  const levels = [["marz", t("data_marz")], ["communities", t("data_communities")]];
  $("#dataLevels").innerHTML = levels.map(([k, l]) =>
    `<button data-l="${k}">${l}</button>`).join("");
  $("#dataLevels").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => setState({ level: b.dataset.l }, { push: false }) || drawExplorer()));

  $("#dataSearch").addEventListener("input", drawExplorer);

  const dir = `data/${electionId}`;
  const dl = [
    ["stations.parquet", `${dir}/clean/stations.parquet`],
    ["stations.csv", `${dir}/clean/stations.csv`],
    ["marz.csv", `${dir}/clean/marz.csv`],
    ["communities.csv", `${dir}/clean/communities.csv`],
    ["marz.geojson", "data/armenia-marz.geojson"],
  ];
  $("#downloadLinks").innerHTML = dl.map(([n, u]) =>
    `<a href="${u}" download>${n}</a>`).join("");
  drawExplorer();
}

async function drawExplorer() {
  const s = getState();
  $("#dataLevels").querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.l === s.level));
  let rows;
  if (s.level === "communities") {
    communities = communities || await loadCommunities(electionId);
    rows = communities;
  } else {
    rows = Object.values(core.marz).map((m) => ({
      _name: marzName(m.iso), marz_en: m.name_en, registered: m.registered,
      turnout_pct: m.turnout_pct, valid: m.valid,
      civil_contract: m.shares.civil_contract.votes,
      strong_armenia: m.shares.strong_armenia.votes,
      armenia_alliance: m.shares.armenia_alliance.votes,
    }));
  }
  explorerTable($("#explorerTable"), rows, s.level, core.parties, $("#dataSearch").value);
}

/* ---------------- about ---------------- */
function renderAbout() {
  const src = core.meta.source;
  const items = [
    { h: t("about_source"), b: `${src.authority}<br><a href="${src.results_by_station}" target="_blank" rel="noopener">results by polling station ↗</a> · <a href="${src.polling_station_registry}" target="_blank" rel="noopener">station registry ↗</a>` },
    { h: t("about_repro"), b: t("about_repro_body") },
    { h: t("about_boundaries"), b: src.boundaries },
    { h: t("about_links"), b: "Parties, leaders and provinces are cross-referenced to Wikidata QIDs and Wikipedia articles in EN/HY/FR." },
  ];
  $("#aboutGrid").innerHTML = items.map((i) =>
    `<div class="ab"><h4>${i.h}</h4><p class="muted small">${i.b}</p></div>`).join("");
}

/* ---------------- scrollspy ---------------- */
// On touch devices a tap fires a synthetic mousemove that shows a tooltip but
// no mouseleave follows, so the tooltip can linger while scrolling. Dismiss it
// on scroll and when a touch ends.
function wireTooltipDismiss() {
  const hide = () => document.querySelectorAll(".tooltip").forEach((el) => { el.style.opacity = "0"; });
  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("touchmove", hide, { passive: true });
  window.addEventListener("touchend", hide, { passive: true });
}

function wireScrollSpy() {
  const links = [...document.querySelectorAll(".mainnav a")];
  const map = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        links.forEach((l) => l.classList.remove("active"));
        map.get(e.target.id)?.classList.add("active");
      }
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll("main section[id]").forEach((s) => obs.observe(s));
}
