// Data loading: JSON via fetch, polling-station table via Parquet (hyparquet),
// with a CSV fallback so the page still works if the Parquet reader can't load.

const base = new URL(".", import.meta.url).href.replace(/\/js\/$/, "/");

export const DEFAULT_ELECTION = "2026";

async function getJSON(path) {
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  return r.json();
}

// Index of available elections (data/elections.json). Falls back to a minimal
// 2026-only manifest if the index is missing, so the site keeps working.
export async function loadElections() {
  try {
    return await getJSON("data/elections.json");
  } catch (e) {
    return {
      default: DEFAULT_ELECTION,
      shared: { marz_geojson: "data/armenia-marz.geojson" },
      elections: [{ id: DEFAULT_ELECTION, dir: "data/2026", status: "available" }],
    };
  }
}

export async function loadCore(election = DEFAULT_ELECTION) {
  const dir = `data/${election}`;
  const [national, marz, parties, links, meta, geo, profiles, comGeo, settGeo] = await Promise.all([
    getJSON(`${dir}/national.json`),
    getJSON(`${dir}/marz.json`),
    getJSON(`${dir}/parties.json`),
    getJSON(`${dir}/links.json`),
    getJSON(`${dir}/meta.json`),
    getJSON("data/armenia-marz.geojson"),
    getJSON(`${dir}/party_profiles.json`),
    getJSON(`${dir}/communities_geo.json`),
    getJSON(`${dir}/settlements_geo.json`).catch(() => ({ by_community: {} })),
  ]);
  return {
    election, national, marz, parties, links, meta, geo,
    profiles: profiles.profiles, communitiesGeo: comGeo.communities,
    comCoverage: { located: comGeo.located, total: comGeo.total },
    settlementsByCommunity: settGeo.by_community || {},
  };
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

export async function loadCommunities(election = DEFAULT_ELECTION) {
  return loadCSV(`data/${election}/clean/communities.csv`);
}
