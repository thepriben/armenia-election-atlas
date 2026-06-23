import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { t, pickLangField } from "./i18n.js";

const fmtInt = (n) => n.toLocaleString();

export function voteBars(el, national) {
  const data = national.parties.filter((p) => p.pct >= 0.9);
  const W = 520, rowH = 30, m = { l: 150, r: 56, t: 18, b: 28 };
  const H = m.t + m.b + data.length * rowH;
  const x = d3.scaleLinear().domain([0, Math.max(50, d3.max(data, (d) => d.pct))]).range([m.l, W - m.r]);
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`);

  // party-entry threshold line (varies by election)
  const thr = national.threshold_party_pct ?? 4;
  const xt = x(thr);
  svg.append("line").attr("x1", xt).attr("x2", xt).attr("y1", m.t - 6).attr("y2", H - m.b)
    .attr("stroke", "var(--muted)").attr("stroke-dasharray", "3 3").attr("opacity", .7);
  svg.append("text").attr("x", xt).attr("y", m.t - 9).attr("fill", "var(--muted)")
    .attr("font-size", 10).attr("text-anchor", "middle").text(thr + "%");

  const g = svg.selectAll("g.row").data(data).join("g").attr("class", "row")
    .attr("transform", (d, i) => `translate(0, ${m.t + i * rowH})`);
  g.append("text").attr("x", m.l - 10).attr("y", rowH / 2).attr("dy", ".35em")
    .attr("text-anchor", "end").attr("fill", "var(--text)").attr("font-size", 11.5)
    .text((d) => truncate(pickLangField(d, "name"), 22));
  g.append("rect").attr("x", m.l).attr("y", 5).attr("height", rowH - 12).attr("rx", 4)
    .attr("fill", (d) => d.color).attr("width", 0)
    .transition().duration(700).attr("width", (d) => x(d.pct) - m.l);
  g.append("text").attr("x", (d) => x(d.pct) + 6).attr("y", rowH / 2).attr("dy", ".35em")
    .attr("fill", "var(--text)").attr("font-size", 11).attr("font-weight", 700)
    .text((d) => d.pct.toFixed(1) + "%");
}

export function hemicycle(el, national) {
  const seated = national.parties.filter((p) => p.seats > 0);
  const total = national.total_seats;
  const W = 460, H = 250, cx = W / 2, cy = H - 12;
  const coords = parliamentSeats(total, 7, 70, W / 2 - 12);
  // assign parties to seats in left->right order
  const order = [];
  seated.forEach((p) => { for (let i = 0; i < p.seats; i++) order.push(p); });
  while (order.length < total) order.push(null);

  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("circle").data(coords).join("circle")
    .attr("cx", (d) => cx + d.x).attr("cy", (d) => cy - d.y).attr("r", d3.min([6, coords.r]))
    .attr("fill", (d, i) => order[i] ? order[i].color : "var(--surface-2)")
    .attr("stroke", "var(--bg)").attr("stroke-width", .8)
    .attr("opacity", 0).transition().delay((d, i) => i * 4).attr("opacity", 1);

  // majority marker
  svg.append("text").attr("x", cx).attr("y", cy - 6).attr("text-anchor", "middle")
    .attr("fill", "var(--muted)").attr("font-size", 11)
    .text(`${seated[0].seats} / ${total}`);
}

function parliamentSeats(n, rows, r0, r1) {
  // capacity proportional to row radius
  const radii = d3.range(rows).map((k) => r0 + (r1 - r0) * (rows === 1 ? 0 : k / (rows - 1)));
  const caps = radii.map((r) => r);
  const sum = d3.sum(caps);
  let alloc = caps.map((c) => Math.max(1, Math.round((c / sum) * n)));
  // fix rounding
  let diff = n - d3.sum(alloc);
  let i = alloc.length - 1;
  while (diff !== 0) { alloc[i] += Math.sign(diff); diff -= Math.sign(diff); i = (i - 1 + alloc.length) % alloc.length; }
  const pts = [];
  radii.forEach((r, k) => {
    const c = alloc[k];
    for (let j = 0; j < c; j++) {
      const ang = Math.PI - (c === 1 ? Math.PI / 2 : (Math.PI * j) / (c - 1));
      pts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r, ang });
    }
  });
  pts.sort((a, b) => b.ang - a.ang); // left to right
  pts.r = Math.min(7, (r1 - r0) / rows / 1.5 + 2);
  return pts;
}

export function miniMap(el, geo, marz, parties, pid) {
  const partyById = Object.fromEntries(parties.map((p) => [p.id, p]));
  const col = partyById[pid]?.color || "#888";
  const max = Math.max(...Object.values(marz).map((m) => m.shares[pid]?.pct ?? 0), 1);
  const W = 360, H = 240;
  const proj = d3.geoMercator().fitExtent([[8, 8], [W - 8, H - 8]], geo);
  const path = d3.geoPath(proj);
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("path").data(geo.features.filter((f) => marz[f.properties.shapeISO]))
    .join("path").attr("d", path).attr("stroke", "var(--bg)").attr("stroke-width", 1)
    .attr("fill", (f) => {
      const s = marz[f.properties.shapeISO].shares[pid]?.pct ?? 0;
      return d3.interpolateRgb("#e9edf5", col)(Math.min(s / max, 1));
    });
}

export function communityMap({ el, geo, communities, parties, lang, marzNameFn }) {
  const partyById = Object.fromEntries(parties.map((p) => [p.id, p]));
  const tip = ensureTooltip();
  const W = 860, H = 560;
  const located = communities.filter((c) => c.lat != null);
  const proj = d3.geoMercator().fitExtent([[18, 18], [W - 18, H - 28]], geo);
  const path = d3.geoPath(proj);
  const r = d3.scaleSqrt().domain([0, d3.max(located, (c) => c.registered)]).range([1.5, 26]);

  const svg = d3.select(el).html("").append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg.append("g");
  g.append("g").selectAll("path").data(geo.features).join("path")
    .attr("class", "marz-base").attr("d", path);

  const dots = g.append("g").selectAll("circle")
    .data(located.sort((a, b) => b.registered - a.registered)).join("circle")
    .attr("class", "community-bubble")
    .attr("cx", (c) => proj([c.lon, c.lat])[0])
    .attr("cy", (c) => proj([c.lon, c.lat])[1])
    .attr("r", 0).attr("fill", (c) => c.winner_color).attr("fill-opacity", .82)
    .on("mousemove", (ev, c) => showTip(ev, c))
    .on("mouseleave", () => tip.style("opacity", 0));
  dots.transition().duration(700).delay((c, i) => i * 3).attr("r", (c) => r(c.registered));

  const zoom = d3.zoom().scaleExtent([1, 14]).translateExtent([[0, 0], [W, H]])
    .on("zoom", (ev) => {
      g.attr("transform", ev.transform);
      dots.attr("r", (c) => r(c.registered) / Math.sqrt(ev.transform.k))
        .attr("stroke-width", .5 / ev.transform.k);
      g.selectAll(".marz-base").attr("stroke-width", 1 / ev.transform.k);
    });
  svg.call(zoom);

  function showTip(ev, c) {
    const rows = c.top.map((tp) => {
      const p = partyById[tp.id];
      return `<div class="tt-row"><span><i class="d" style="background:${p.color}"></i>${esc(pickLangField(p, "name"))}</span><b>${tp.pct.toFixed(1)}%</b></div>`;
    }).join("");
    tip.html(`<div class="tt-title">${esc(c.community)} · <span style="color:var(--muted)">${esc(marzNameFn(c.marz_iso))}</span></div>${rows}
      <div class="tt-row" style="margin-top:6px;color:var(--muted)"><span>${t("panel_turnout")}</span><b>${c.turnout_pct}%</b></div>
      <div class="tt-row" style="color:var(--muted)"><span>${t("panel_registered")}</span><b>${c.registered.toLocaleString()}</b></div>`);
    tip.style("opacity", 1);
    const pad = 16, w = 240;
    let x = ev.clientX + pad; if (x + w > innerWidth) x = ev.clientX - w - pad;
    tip.style("left", x + "px").style("top", ev.clientY + pad + "px");
  }
  return {
    zoomBy: (k) => svg.transition().call(zoom.scaleBy, k),
    reset: () => svg.transition().call(zoom.transform, d3.zoomIdentity),
  };
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function ensureTooltip() {
  let el = document.querySelector(".tooltip");
  if (!el) { el = document.createElement("div"); el.className = "tooltip"; document.body.appendChild(el); }
  return d3.select(el);
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
