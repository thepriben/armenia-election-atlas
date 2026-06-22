import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { t, pickLangField, getLang } from "./i18n.js";

export function createMap({ el, geo, marz, parties, onSelect }) {
  const partyById = Object.fromEntries(parties.map((p) => [p.id, p]));
  const tip = ensureTooltip();
  const W = 860, H = 560;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const gShapes = svg.append("g");
  const gLabels = svg.append("g");

  const proj = d3.geoMercator().fitExtent([[18, 18], [W - 18, H - 28]], geo);
  const path = d3.geoPath(proj);

  const feats = geo.features.filter((f) => marz[f.properties.shapeISO]);

  const shapes = gShapes.selectAll("path").data(feats).join("path")
    .attr("class", "marz")
    .attr("d", path)
    .on("mousemove", (ev, f) => showTip(ev, f))
    .on("mouseleave", hideTip)
    .on("click", (ev, f) => onSelect(f.properties.shapeISO));

  const labels = gLabels.selectAll("text").data(feats).join("text")
    .attr("class", "marz-label")
    .attr("text-anchor", "middle")
    .attr("transform", (f) => `translate(${path.centroid(f)})`)
    .text((f) => marzName(f.properties.shapeISO));

  function marzName(iso) {
    const m = marz[iso];
    return pickLangField({ name_en: m.name_en, name_hy: m.name_hy, name_fr: m.name_fr }, "name");
  }

  function colorFor(iso, state) {
    const m = marz[iso];
    if (state.view === "winner") return partyById[m.winner]?.color || "#888";
    if (state.view === "margin") return scales.margin(m.margin);
    if (state.view === "turnout") return scales.turnout(m.turnout_pct);
    if (state.view === "party") {
      const share = m.shares[state.party]?.pct ?? 0;
      return scales.party(share);
    }
    return "#888";
  }

  // sequential scales (domains computed from data)
  const marginVals = Object.values(marz).map((m) => m.margin);
  const turnoutVals = Object.values(marz).map((m) => m.turnout_pct);
  const scales = {
    margin: d3.scaleSequential(d3.interpolateYlOrRd).domain([d3.min(marginVals) - 3, d3.max(marginVals)]),
    turnout: d3.scaleSequential(d3.interpolateViridis).domain([d3.min(turnoutVals), d3.max(turnoutVals)]),
    party: d3.scaleSequential(d3.interpolatePlasma).domain([0, 60]),
  };

  function setPartyScale(pid) {
    const max = Math.max(...Object.values(marz).map((m) => m.shares[pid]?.pct ?? 0));
    const col = partyById[pid]?.color || "#888";
    scales.party = (v) => d3.interpolateRgb("#e9edf5", col)(Math.min(v / Math.max(max, 1), 1));
    scales.party.domainMax = max;
  }

  let cur = null;
  function render(state) {
    cur = state;
    if (state.view === "party") setPartyScale(state.party);
    shapes.transition().duration(450)
      .attr("fill", (f) => colorFor(f.properties.shapeISO, state));
    shapes.classed("selected", (f) => f.properties.shapeISO === state.marz);
    labels.text((f) => marzName(f.properties.shapeISO));
  }

  function showTip(ev, f) {
    const iso = f.properties.shapeISO, m = marz[iso];
    const rows = m.order.slice(0, 3).map((pid) => {
      const p = partyById[pid];
      return `<div class="tt-row"><span><i class="d" style="background:${p.color}"></i>${escape(pickLangField(p, "name"))}</span><b>${m.shares[pid].pct.toFixed(1)}%</b></div>`;
    }).join("");
    tip.html(`<div class="tt-title">${escape(marzName(iso))}</div>${rows}
      <div class="tt-row" style="margin-top:6px;color:var(--muted)"><span>${t("panel_turnout")}</span><b>${m.turnout_pct}%</b></div>`);
    tip.style("opacity", 1);
    moveTip(ev);
  }
  function moveTip(ev) {
    const pad = 16, w = 240;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > innerWidth) x = ev.clientX - w - pad;
    tip.style("left", x + "px").style("top", y + "px");
  }
  function hideTip() { tip.style("opacity", 0); }
  d3.select(el).on("mousemove", (ev) => { if (+tip.style("opacity") > 0) moveTip(ev); });

  return { render, scales, setPartyScale, get state() { return cur; } };
}

export function renderLegend(el, mapApi, state) {
  const d3sel = d3.select(el).html("");
  if (state.view === "winner") {
    d3sel.append("div").attr("class", "small muted").text(t("map_mode_winner"));
    const sw = d3sel.append("div").attr("class", "swatches");
    sw.append("span").attr("class", "sw").html(`<i style="background:#F58220"></i>Civil Contract`);
    return;
  }
  let label, scale, fmt, max;
  if (state.view === "margin") { label = t("legend_margin"); scale = mapApi.scales.margin; fmt = (v) => `+${Math.round(v)}`; }
  else if (state.view === "turnout") { label = t("legend_turnout"); scale = mapApi.scales.turnout; fmt = (v) => Math.round(v); }
  else { label = t("legend_share"); max = mapApi.scales.party.domainMax || 60; }

  const grad = legendGradient(state, mapApi, max);
  d3sel.append("div").attr("class", "small muted").text(label);
  d3sel.append("div").attr("class", "bar").style("background", grad);
  const ticks = d3sel.append("div").attr("class", "ticks");
  if (state.view === "party") { ticks.append("span").text("0%"); ticks.append("span").text(`${Math.round(max)}%`); }
  else {
    const dom = scale.domain();
    ticks.append("span").text(fmt(dom[0]));
    ticks.append("span").text(fmt(dom[1]));
  }
}

function legendGradient(state, mapApi, max) {
  const stops = [];
  for (let i = 0; i <= 10; i++) {
    const f = i / 10;
    let c;
    if (state.view === "margin") c = mapApi.scales.margin(mapApi.scales.margin.domain()[0] + f * (mapApi.scales.margin.domain()[1] - mapApi.scales.margin.domain()[0]));
    else if (state.view === "turnout") c = mapApi.scales.turnout(mapApi.scales.turnout.domain()[0] + f * (mapApi.scales.turnout.domain()[1] - mapApi.scales.turnout.domain()[0]));
    else c = mapApi.scales.party(f * (max));
    stops.push(`${c} ${f * 100}%`);
  }
  return `linear-gradient(90deg, ${stops.join(",")})`;
}

function ensureTooltip() {
  let el = document.querySelector(".tooltip");
  if (!el) { el = document.createElement("div"); el.className = "tooltip"; document.body.appendChild(el); }
  return d3.select(el);
}
function escape(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
