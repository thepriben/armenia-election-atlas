// Data loading: JSON via fetch, polling-station table via Parquet (hyparquet),
// with a CSV fallback so the page still works if the Parquet reader can't load.

const base = new URL(".", import.meta.url).href.replace(/\/js\/$/, "/");

async function getJSON(path) {
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  return r.json();
}

export async function loadCore() {
  const [national, marz, parties, links, meta, geo, profiles, context, comGeo] = await Promise.all([
    getJSON("data/national.json"),
    getJSON("data/marz.json"),
    getJSON("data/parties.json"),
    getJSON("data/links.json"),
    getJSON("data/meta.json"),
    getJSON("data/armenia-marz.geojson"),
    getJSON("data/party_profiles.json"),
    getJSON("data/marz_context.json"),
    getJSON("data/communities_geo.json"),
  ]);
  return {
    national, marz, parties, links, meta, geo,
    profiles: profiles.profiles, context, communitiesGeo: comGeo.communities,
    comCoverage: { located: comGeo.located, total: comGeo.total },
  };
}

let _stations = null;
export async function loadStations() {
  if (_stations) return _stations;
  try {
    const { asyncBufferFromUrl, parquetReadObjects } =
      await import("https://cdn.jsdelivr.net/npm/hyparquet@1.17.1/+esm");
    const file = await asyncBufferFromUrl({ url: base + "data/clean/stations.parquet" });
    const rows = await parquetReadObjects({ file });
    // hyparquet returns BigInt for int64 columns — coerce to Number for arithmetic
    _stations = rows.map((r) => {
      const o = {};
      for (const k in r) o[k] = typeof r[k] === "bigint" ? Number(r[k]) : r[k];
      return o;
    });
  } catch (e) {
    console.warn("Parquet load failed, falling back to CSV:", e);
    _stations = await loadCSV("data/clean/stations.csv");
  }
  return _stations;
}

async function loadCSV(path) {
  const text = await (await fetch(base + path)).text();
  const [head, ...lines] = text.trim().split("\n");
  const cols = head.split(",");
  const numeric = new Set([
    "registered", "ballots_cast", "invalid", "valid", "turnout_pct", "inaccuracy",
  ]);
  return lines.map((ln) => {
    const cells = ln.split(",");
    const o = {};
    cols.forEach((c, i) => {
      const v = cells[i];
      o[c] = numeric.has(c) || /^[\d.+-]+$/.test(v) ? Number(v) : v;
    });
    return o;
  });
}

export async function loadCommunities() {
  return loadCSV("data/clean/communities.csv");
}
