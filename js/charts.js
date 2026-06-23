import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { t, pickLangField } from "./i18n.js";

const fmtInt = (n) => n.toLocaleString();

export function voteBars(el, national) {
  const data = national.parties.filter((p) => p.pct >= 0.9);
  const W = 520, rowH = 30, m = { l: 150, r: 56, t: 18, b: 28 };
  const H = m.t + m.b + data.length * rowH;
  const x = d3.scaleLinear().domain([0, Math.max(50, d3.max(data, (d) => d.pct))]).range([m.l, W - m.r]);
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`);

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
  const order = [];
  seated.forEach((p) => { for (let i = 0; i < p.seats; i++) order.push(p); });
  while (order.length < total) order.push(null);

  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("circle").data(coords).join("circle")
    .attr("cx", (d) => cx + d.x).attr("cy", (d) => cy - d.y).attr("r", d3.min([6, coords.r]))
    .attr("fill", (d, i) => order[i] ? order[i].color : "var(--surface-2)")
    .attr("stroke", "var(--bg)").attr("stroke-width", .8)
    .attr("opacity", 0).transition().delay((d, i) => i * 4).attr("opacity", 1);

  svg.append("text").attr("x", cx).attr("y", cy - 6).attr("text-anchor", "middle")
    .attr("fill", "var(--muted)").attr("font-size", 11)
    .text(`${seated[0].seats} / ${total}`);
}

function parliamentSeats(n, rows, r0, r1) {
  const radii = d3.range(rows).map((k) => r0 + (r1 - r0) * (rows === 1 ? 0 : k / (rows - 1)));
  const caps = radii.map((r) => r);
  const sum = d3.sum(caps);
  let alloc = caps.map((c) => Math.max(1, Math.round((c / sum) * n)));
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
  pts.sort((a, b) => b.ang - a.ang);
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

/** One-line place caption: locality + province, with disambiguation when names collide. */
export function placeCaption(c, marzNameFn) {
  const name = pickLangField(c, "community") || c.community || c.community_hy || "";
  const marz = marzNameFn(c.marz_iso);
  if (c.is_district || c.marz_en === "Yerevan") return `${name}, ${marz}`;
  if (c.same_as_marz || (name && marz && name.toLowerCase() === marz.toLowerCase()))
    return `${t("community_municipality").replace("{name}", name)} (${marz})`;
  return `${name}, ${marz}`;
}

export function localityCaption(s, parent) {
  const name = pickLangField(s, "locality") || s.locality || s.locality_hy || "";
  const comm = pickLangField(parent, "community") || parent.community || parent.community_hy;
  return `${name}, ${comm}`;
}

export function communityMap({
  el, geo, communities, parties, marzNameFn,
  settlementsByCommunity = {}, onDrill = null,
}) {
  const partyById = Object.fromEntries(parties.map((p) => [p.id, p]));
  const tip = ensureTooltip();
  const W = 860, H = 560;
  const proj = d3.geoMercator().fitExtent([[18, 18], [W - 18, H - 28]], geo);
  const path = d3.geoPath(proj);

  const allCommunities = communities.filter((c) => c.lat != null);
  let drill = null;
  let zoomK = 1;
  let zoomT = d3.zoomIdentity;

  const svg = d3.select(el).html("").append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg.append("g");
  g.append("g").selectAll("path").data(geo.features).join("path")
    .attr("class", "marz-base").attr("d", path);
  const layer = g.append("g").attr("class", "community-layer");
  const clusterG = g.append("g").attr("class", "community-clusters");

  function commKey(c) { return `${c.marz_iso}|${c.community || c.community_hy}`; }

  function layoutItems(items, rScale, maxDrift = 12) {
    items.sort((a, b) => b.registered - a.registered);
    items.forEach((c) => {
      const p = proj([c.lon, c.lat]);
      c._x = p[0]; c._y = p[1]; c.x = p[0]; c.y = p[1];
    });
    const sim = d3.forceSimulation(items)
      .force("x", d3.forceX((c) => c._x).strength(.85))
      .force("y", d3.forceY((c) => c._y).strength(.85))
      .force("collide", d3.forceCollide((c) => rScale(c.registered) + .35).strength(.75))
      .stop();
    for (let i = 0; i < 120; i++) sim.tick();
    for (const c of items) {
      const dx = c.x - c._x, dy = c.y - c._y, d = Math.hypot(dx, dy);
      if (d > maxDrift) {
        c.x = c._x + (dx / d) * maxDrift;
        c.y = c._y + (dy / d) * maxDrift;
      }
    }
    return items;
  }

  const rComm = d3.scaleSqrt()
    .domain([0, d3.max(allCommunities, (c) => c.registered)])
    .range([1.5, 22]);
  layoutItems(allCommunities, rComm, 12);

  function currentRadius() {
    if (drill) {
      const items = drill.items;
      const r = d3.scaleSqrt().domain([0, d3.max(items, (c) => c.registered)]).range([1.2, 14]);
      return (c) => r(c.registered) / Math.sqrt(zoomK);
    }
    return (c) => rComm(c.registered) / Math.sqrt(zoomK);
  }

  function showTip(ev, item, caption) {
    const rows = item.top.map((tp) => {
      const p = partyById[tp.id];
      return `<div class="tt-row"><span><i class="d" style="background:${p.color}"></i>${esc(pickLangField(p, "name"))}</span><b>${tp.pct.toFixed(1)}%</b></div>`;
    }).join("");
    const drillHint = !drill && (item.settlement_count || 0) > 1
      ? `<div class="tt-meta tt-drill">${esc(t("explore_drill_hint").replace("{n}", item.settlement_count))}</div>` : "";
    tip.html(`<div class="tt-title">${esc(caption)}</div>
      <div class="tt-meta">${item.turnout_pct}% ${t("panel_turnout").toLowerCase()} · ${item.registered.toLocaleString()} ${t("panel_registered").toLowerCase()}</div>${drillHint}${rows}`)
      .attr("class", "tooltip tooltip--place");
    tip.style("opacity", 1);
    const pad = 12, w = 220;
    let x = ev.clientX + pad; if (x + w > innerWidth) x = ev.clientX - w - pad;
    tip.style("left", x + "px").style("top", ev.clientY + pad + "px");
  }

  function hideTip() {
    tip.style("opacity", 0).attr("class", "tooltip");
  }

  function zoomToItems(items) {
    if (!items.length) return;
    const xs = items.map((c) => c.x), ys = items.map((c) => c.y);
    const pad = 36;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
    const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const k = Math.min(14, 0.92 / Math.max((x1 - x0) / W, (y1 - y0) / H));
    const tx = W / 2 - (k * (x0 + x1) / 2);
    const ty = H / 2 - (k * (y0 + y1) / 2);
    svg.transition().duration(450).call(
      zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  function enterDrill(c, ev) {
    ev.stopPropagation();
    const key = commKey(c);
    const raw = (settlementsByCommunity[key] || []).filter((s) => s.lat != null);
    if (raw.length <= 1) return;
    hideTip();
    drill = { parent: c, key, items: layoutItems(raw, (n) => {
      const r = d3.scaleSqrt().domain([0, d3.max(raw, (x) => x.registered)]).range([1.2, 14]);
      return r(n);
    }, 18) };
    if (onDrill) onDrill(drill);
    zoomToItems(drill.items);
    render();
  }

  function exitDrill() {
    if (!drill) return;
    drill = null;
    hideTip();
    if (onDrill) onDrill(null);
    svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity);
    render();
  }

  function pixelClusters(items, threshold) {
    const n = items.length;
    const parent = d3.range(n);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const unite = (a, b) => { parent[find(a)] = find(b); };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) < threshold) unite(i, j);
      }
    }
    const groups = new Map();
    items.forEach((c, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(c);
    });
    return [...groups.values()];
  }

  function renderClusters(items, clustered, multi) {
    clusterG.selectAll("g.cluster").data(multi, (d) => d.map((c) => commKey(c)).sort().join("|"))
      .join(
        (enter) => {
          const ng = enter.append("g").attr("class", "cluster").style("cursor", "pointer");
          ng.append("circle").attr("class", "cluster-halo");
          ng.append("circle").attr("class", "cluster-core");
          ng.append("text").attr("class", "cluster-count");
          ng.on("click", (ev, members) => {
            ev.stopPropagation();
            hideTip();
            if (!drill && members.length === 1 && (members[0].settlement_count || 0) > 1) {
              enterDrill(members[0], ev);
              return;
            }
            const cx = d3.mean(members, (c) => c.x);
            const cy = d3.mean(members, (c) => c.y);
            const span = Math.max(...members.map((c) => Math.hypot(c.x - cx, c.y - cy)), 12);
            const k = Math.min(14, Math.max(2.8, (W * 0.22) / span));
            svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity
              .translate(W / 2, H / 2).scale(k).translate(-cx, -cy));
          });
          return ng;
        },
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("transform", (members) => {
        const cx = d3.mean(members, (c) => c.x);
        const cy = d3.mean(members, (c) => c.y);
        return `translate(${cx},${cy})`;
      })
      .each(function (members) {
        const rad = Math.min(22, 8 + members.length * 2.2) / Math.sqrt(zoomK);
        d3.select(this).select(".cluster-halo").attr("r", rad + 4 / zoomK).attr("stroke-width", 1.2 / zoomK);
        d3.select(this).select(".cluster-core").attr("r", rad).attr("stroke-width", .8 / zoomK);
        d3.select(this).select(".cluster-count")
          .attr("text-anchor", "middle").attr("dy", ".35em").attr("font-size", Math.max(10, 12 / Math.sqrt(zoomK)))
          .text(String(members.length));
      });
  }

  function render() {
    const rr = currentRadius();
    clusterG.selectAll("*").remove();

    if (drill) {
      const items = drill.items;
      layer.selectAll("circle").data(items, (c) => c.locality_hy + c.marz_iso)
        .join(
          (enter) => enter.append("circle").attr("class", "community-bubble community-bubble--local")
            .attr("fill", (c) => c.winner_color).attr("fill-opacity", .82)
            .on("mouseover", (ev, c) => { d3.select(ev.currentTarget).raise(); showTip(ev, c, localityCaption(c, drill.parent)); })
            .on("mousemove", (ev, c) => showTip(ev, c, localityCaption(c, drill.parent)))
            .on("mouseleave", hideTip),
          (update) => update,
          (exit) => exit.remove(),
        )
        .attr("cx", (c) => c.x).attr("cy", (c) => c.y)
        .attr("r", rr).attr("stroke-width", .5 / zoomK);
      return;
    }

    const useClusters = zoomK < 3.5;
    const threshold = 34 / zoomK;
    const clustered = new Set();
    const multi = [];
    if (useClusters) {
      pixelClusters(allCommunities, threshold).forEach((members) => {
        if (members.length > 1) {
          multi.push(members);
          members.forEach((c) => clustered.add(c));
        }
      });
    }
    renderClusters(allCommunities, clustered, multi);

    layer.selectAll("circle.community-bubble").data(allCommunities.filter((c) => !clustered.has(c)), commKey)
      .join(
        (enter) => enter.append("circle").attr("class", "community-bubble")
          .attr("fill", (c) => c.winner_color).attr("fill-opacity", .82)
          .on("mouseover", (ev, c) => { d3.select(ev.currentTarget).raise(); showTip(ev, c, placeCaption(c, marzNameFn)); })
          .on("mousemove", (ev, c) => showTip(ev, c, placeCaption(c, marzNameFn)))
          .on("mouseleave", hideTip)
          .on("click", (ev, c) => {
            if ((c.settlement_count || 0) > 1) enterDrill(c, ev);
          }),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("cx", (c) => c.x).attr("cy", (c) => c.y)
      .attr("r", rr).attr("stroke-width", .5 / zoomK)
      .style("cursor", (c) => (c.settlement_count || 0) > 1 ? "pointer" : null);
  }

  render();

  const zoom = d3.zoom().scaleExtent([1, 14]).translateExtent([[0, 0], [W, H]])
    .on("zoom", (ev) => {
      zoomK = ev.transform.k;
      zoomT = ev.transform;
      hideTip();
      g.attr("transform", ev.transform);
      g.selectAll(".marz-base").attr("stroke-width", 1 / zoomK);
      render();
    });
  svg.call(zoom);

  return {
    zoomBy: (k) => svg.transition().duration(300).call(zoom.scaleBy, k),
    reset: () => { exitDrill(); hideTip(); svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity); },
    exitDrill,
  };
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function ensureTooltip() {
  let el = document.querySelector(".tooltip");
  if (!el) { el = document.createElement("div"); el.className = "tooltip"; document.body.appendChild(el); }
  return d3.select(el);
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
