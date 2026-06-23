#!/usr/bin/env python3
"""
Attach coordinates to the 81 CEC communities using the GeoNames gazetteer
(free, CC-BY). Produces data/<ELECTION>/communities_geo.json for the zoomable bubble map:
each community as a point (electorate-sized, winner-coloured) with its top results.

GeoNames AM dump: https://download.geonames.org/export/dump/AM.zip  (AM.txt, TSV)
Columns: geonameid, name, asciiname, alternatenames, lat, lon, fclass, fcode, ...
"""
from __future__ import annotations

import collections
import csv
import json
import math
import os
import pathlib
import re
import sys

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
ELECTION = os.environ.get("ELECTION", "2026")
DATA = ROOT / "data" / ELECTION
GEONAMES = pathlib.Path("/tmp/AM.txt")
COMMUNITIES = DATA / "clean" / "communities.parquet"
SETTLEMENTS = DATA / "clean" / "settlements.parquet"

# feature-class preference: populated places, then admin areas
FCLASS_RANK = {"P": 0, "A": 1, "L": 3, "T": 3, "H": 4, "S": 2, "V": 3, "R": 3}

# CEC province (marz_en) -> GeoNames admin1 code. Used to disambiguate the many
# homonymous villages (a dozen " Նոր …", "Վերին …", several "Շահումյան" etc.)
# that otherwise collapse onto a single wrong point.
MARZ_ADM1 = {
    "Aragatsotn": "01", "Ararat": "02", "Armavir": "03", "Gegharkunik": "04",
    "Kotayk": "05", "Lori": "06", "Shirak": "07", "Syunik": "08",
    "Tavush": "09", "Vayots Dzor": "10", "Yerevan": "11",
}


def load_geonames():
    """name (Armenian or latin) -> list of (rank, -pop, lat, lon, fclass, admin1, en, fr)."""
    idx = {}
    with open(GEONAMES, encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t"):
            if len(row) < 15:
                continue
            try:
                lat, lon = float(row[4]), float(row[5])
            except ValueError:
                continue
            fclass = row[6]
            admin1 = row[10]
            pop = int(row[14]) if row[14].isdigit() else 0
            rank = FCLASS_RANK.get(fclass, 5)
            en = row[2] or row[1]
            fr = _pick_alt_lang(row[3], "fr") or en
            names = {row[1], row[2]}
            names.update(n for n in row[3].split(",") if n)
            for nm in names:
                key = normalize(nm)
                if key:
                    idx.setdefault(key, []).append((rank, -pop, lat, lon, fclass, admin1, en, fr))
    for nm in idx:
        idx[nm].sort()
    return idx


def _pick_alt_lang(alt_field: str, lang: str) -> str | None:
    """Best-effort French (or other) label from GeoNames alternatenames."""
    if not alt_field:
        return None
    parts = [p.strip() for p in alt_field.split(",") if p.strip()]
    for i, p in enumerate(parts):
        if p == lang and i > 0:
            return parts[i - 1]
    return None


# Yerevan administrative districts — GeoNames often returns "Yerevan" for several.
YEREVAN_DISTRICTS = {
    "Աջափնյակ": (40.19917, 44.47056, "Ajapnyak", "Ajapnyak"),
    "Ավան": (40.21436, 44.57846, "Avan", "Avan"),
    "Արաբկիր": (40.20549, 44.50699, "Arabkir", "Arabkir"),
    "Դավթաշեն": (40.21642, 44.48088, "Davtashen", "Davtashen"),
    "Էրեբունի": (40.17765, 44.5126, "Erebuni", "Erebouni"),
    "Կենտրոն": (40.17806, 44.51303, "Kentron", "Kentron"),
    "Մալաթիա-Սեբաստիա": (40.17396, 44.4457, "Malatia-Sebastia", "Malatia-Sebastia"),
    "Նոր Նորք": (40.19661, 44.5669, "Nor Nork", "Nor Nork"),
    "Նորք-Մարաշ": (40.17417, 44.54083, "Nork-Marash", "Nork-Marash"),
    "Նուբարաշեն": (40.1296, 44.5406, "Nubarashen", "Nubarashen"),
    "Շենգավիթ": (40.1557, 44.4779, "Shengavit", "Shengavit"),
    "Քանաքեռ-Զեյթուն": (40.22, 44.53833, "Kanaker-Zeytun", "Kanaker-Zeytun"),
}

# Communities GeoNames cannot resolve (ligature edge cases / consolidated municipalities).
# Note: Arevut and Baghramyan are intentionally NOT pinned here — they have several
# in-province homonyms and are disambiguated by their settlement centroid instead.
MANUAL = {
    **YEREVAN_DISTRICTS,
    "Նաիրի": (40.3217, 44.4814, "Nairi", "Nairi"),
    "Անի": (40.5722, 43.8669, "Ani", "Ani"),
}

# Settlement designators appended by the CEC ("village", "town", "station").
_DESIG = re.compile(r"\s+(գյուղ|քաղաք|կայարան|ավան\b)\s*$")


def normalize(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\s*\([^)]*\)\s*", " ", s)   # drop parenthetical qualifiers
    s = re.sub(r"\s+", " ", s).strip()
    s = _DESIG.sub("", s)                      # drop trailing "գյուղ"/"քաղաք"/…
    return s.replace(" յ", "յ")


def _variants(name):
    yield name
    # Armenian ligature: "եվ" <-> "և"
    yield name.replace("եվ", "և")
    yield name.replace("և", "եվ")


def _km_dist(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return math.hypot((lat1 - lat2) * 111.0, (lon1 - lon2) * 85.0)


OSM_CACHE_PATH = ROOT / "scripts" / "osm_cache.json"


def load_osm_cache():
    """Committed OpenStreetMap (Nominatim) coordinates for villages absent from
    GeoNames. Rebuild with scripts/refresh_osm_cache.py; reads are offline."""
    try:
        return json.loads(OSM_CACHE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def osm_fallback(name_hy, marz_en, near, cache):
    val = cache.get(f"{marz_en}|{normalize(name_hy)}")
    if not val:
        return None
    if near and _km_dist(val["lat"], val["lon"], near[0], near[1]) > 30:
        return None
    return val["lat"], val["lon"]


def match(name, marz_en, idx, near=None, max_km: float | None = None):
    """Resolve to (lat, lon, fclass, en, fr). With *near*, pick the closest
    homonym in-province and reject matches farther than *max_km*."""
    if name in MANUAL:
        lat, lon, en, fr = MANUAL[name]
        if near and max_km and _km_dist(lat, lon, near[0], near[1]) > max_km:
            return None
        return lat, lon, "M", en, fr
    target = MARZ_ADM1.get(marz_en)
    for v in _variants(name):
        cands = idx.get(v)
        if not cands:
            continue
        in_prov = [c for c in cands if c[5] == target]
        if not in_prov:
            continue
        if near:
            in_prov.sort(key=lambda c: _km_dist(c[2], c[3], near[0], near[1]))
            c = in_prov[0]
            if max_km and _km_dist(c[2], c[3], near[0], near[1]) > max_km:
                continue
        else:
            c = in_prov[0]
        return c[2], c[3], c[4], c[6], c[7]
    return None


def spread_overlaps(out):
    """Nudge exact duplicate coordinates onto a small deterministic ring (~1 km)."""
    groups = collections.defaultdict(list)
    for c in out:
        if c["lat"] is None:
            continue
        groups[(round(c["lat"], 5), round(c["lon"], 5))].append(c)
    for (lat, lon), members in groups.items():
        if len(members) < 2:
            continue
        radius = 0.012
        for i, c in enumerate(members[1:], start=1):
            ang = 2 * math.pi * i / len(members)
            c["lat"] = round(lat + radius * math.cos(ang), 5)
            c["lon"] = round(lon + radius * math.sin(ang) / math.cos(math.radians(lat)), 5)


def settlement_centroids(sdf, idx):
    """Province-only pass: weighted centroid of each community's settlements, used
    to disambiguate communities that share a name with another place in the same
    province (e.g. the two 'Baghramyan' in Armavir)."""
    acc = {}
    for _, r in sdf.iterrows():
        loc = str(r["locality_hy"]).strip()
        if not loc or loc.lower() == "nan":
            continue
        target = MARZ_ADM1.get(r["marz_en"])
        cand = None
        for v in _variants(normalize(loc)):
            ins = [c for c in idx.get(v, []) if c[5] == target]
            if ins:
                cand = ins[0]
                break
        if not cand:
            continue
        key = f"{r['marz_iso']}|{r['community_hy']}"
        w = max(int(r["registered"]), 1)
        a = acc.setdefault(key, [0.0, 0.0, 0])
        a[0] += cand[2] * w
        a[1] += cand[3] * w
        a[2] += w
    return {k: (v[0] / v[2], v[1] / v[2]) for k, v in acc.items() if v[2] > 0}


def _result_row(r, hy, marz_hy, idx, pids, color, near=None, max_km=None):
    """Build one geocoded feature dict for a community or settlement row."""
    votes = {pid: int(r[pid]) for pid in pids if pid in r}
    order = sorted(votes, key=votes.get, reverse=True)
    valid = max(int(r["valid"]), 1)
    winner = order[0]
    top = [{"id": pid, "pct": round(100 * votes[pid] / valid, 1)} for pid in order[:3]]
    m = match(normalize(hy), r["marz_en"], idx, near=near, max_km=max_km)
    en = fr = None
    if m:
        en, fr = m[3], m[4]
    same_marz = hy == marz_hy.get(r["marz_en"])
    return {
        "registered": int(r["registered"]),
        "turnout_pct": float(r["turnout_pct"]),
        "valid": valid,
        "winner": winner,
        "winner_color": color[winner],
        "margin": round(top[0]["pct"] - (top[1]["pct"] if len(top) > 1 else 0), 1),
        "top": top,
        "lat": m[0] if m else None,
        "lon": m[1] if m else None,
        "name_hy": hy,
        "name_en": en or hy,
        "name_fr": fr or en or hy,
        "same_as_marz": same_marz,
        "_matched": m is not None,
    }


def geocode_communities(df, idx, marz_hy, pids, color, centroids=None):
    centroids = centroids or {}
    out, matched = [], 0
    for _, r in df.iterrows():
        hy = r["community_hy"]
        near = centroids.get(f"{r['marz_iso']}|{hy}")
        rec = _result_row(r, hy, marz_hy, idx, pids, color, near=near)
        if rec.pop("_matched"):
            matched += 1
        out.append({
            "community": hy,
            "community_hy": hy,
            "community_en": rec["name_en"],
            "community_fr": rec["name_fr"],
            "same_as_marz": rec["same_as_marz"],
            "is_district": r["marz_en"] == "Yerevan",
            "marz_en": r["marz_en"],
            "marz_iso": r["marz_iso"],
            **{k: rec[k] for k in ("registered", "turnout_pct", "valid", "winner",
                                   "winner_color", "margin", "top", "lat", "lon")},
        })
    spread_overlaps(out)
    return out, matched


def geocode_settlements(df, idx, marz_hy, pids, color, parent_coords):
    osm_cache = load_osm_cache()
    by_comm = {}
    matched = total = rejected = osm_used = 0
    for _, r in df.iterrows():
        total += 1
        hy = str(r["locality_hy"] or "").strip()
        if not hy or hy.lower() == "nan":
            continue
        comm = r["community_hy"]
        key = f"{r['marz_iso']}|{comm}"
        parent = parent_coords.get(key)
        near = (parent["lat"], parent["lon"]) if parent and parent.get("lat") else None
        rec = _result_row(r, hy, marz_hy, idx, pids, color,
                          near=near, max_km=30 if near else None)
        if rec.pop("_matched"):
            matched += 1
        elif near and rec["lat"] is not None:
            rejected += 1
            rec["lat"] = rec["lon"] = None
        if rec["lat"] is None:
            osm = osm_fallback(hy, r["marz_en"], near, osm_cache)
            if osm:
                rec["lat"], rec["lon"] = osm
                osm_used += 1
        same_comm = normalize(hy) == normalize(comm)
        item = {
            "locality": hy,
            "locality_hy": hy,
            "locality_en": rec["name_en"],
            "locality_fr": rec["name_fr"],
            "same_as_marz": rec["same_as_marz"],
            "same_as_community": same_comm,
            "community_hy": comm,
            "marz_en": r["marz_en"],
            "marz_iso": r["marz_iso"],
            **{k: rec[k] for k in ("registered", "turnout_pct", "valid", "winner",
                                   "winner_color", "margin", "top", "lat", "lon")},
        }
        key = f"{r['marz_iso']}|{comm}"
        by_comm.setdefault(key, []).append(item)
    for items in by_comm.values():
        spread_overlaps(items)
    return by_comm, matched, total, rejected, osm_used


def main():
    if not GEONAMES.exists():
        sys.exit("Missing /tmp/AM.txt — download GeoNames AM.zip first.")
    parties = json.loads((DATA / "parties.json").read_text())
    pids = [p["id"] for p in parties]
    color = {p["id"]: p["color"] for p in parties}

    df = pd.read_parquet(COMMUNITIES)
    idx = load_geonames()
    marz_meta = json.loads((DATA / "marz.json").read_text())
    marz_hy = {m["name_en"]: m["name_hy"] for m in marz_meta.values()}

    # Pass 1: rough settlement centroids to disambiguate community homonyms.
    sdf = pd.read_parquet(SETTLEMENTS) if SETTLEMENTS.exists() else None
    centroids = settlement_centroids(sdf, idx) if sdf is not None else {}

    # Pass 2: communities, picking the in-province homonym nearest its settlements.
    out, matched = geocode_communities(df, idx, marz_hy, pids, color, centroids)
    located = [c for c in out if c["lat"] is not None]

    sett_counts = {}
    sett_by_comm = {}
    sett_matched = sett_total = sett_located = sett_rejected = 0
    if sdf is not None:
        # Pass 3: settlements anchored on the corrected community points.
        parent_coords = {f"{c['marz_iso']}|{c['community']}": c for c in out}
        sett_by_comm, sett_matched, sett_total, sett_rejected, sett_osm = geocode_settlements(
            sdf, idx, marz_hy, pids, color, parent_coords)
        for key, items in sett_by_comm.items():
            sett_counts[key] = len(items)
            sett_located += sum(1 for s in items if s["lat"] is not None)
        for c in out:
            key = f"{c['marz_iso']}|{c['community']}"
            c["settlement_count"] = sett_counts.get(key, 1)
        if sett_rejected:
            print(f"   rejected {sett_rejected} settlement homonym matches (>30 km from commune seat)",
                  file=sys.stderr)
        if sett_osm:
            print(f"   filled {sett_osm} settlements from OpenStreetMap cache", file=sys.stderr)
    else:
        for c in out:
            c["settlement_count"] = 1

    (DATA / "communities_geo.json").write_text(
        json.dumps({"source": "GeoNames (CC-BY) + CEC results",
                    "located": len(located), "total": len(out),
                    "communities": out}, ensure_ascii=False, indent=2),
        encoding="utf-8")
    print(f"Geocoded {matched}/{len(out)} communities")
    miss = [c["community"] for c in out if c["lat"] is None]
    if miss:
        print("Unmatched:", ", ".join(miss))
    from collections import Counter
    print("Winners among located:", Counter(c["winner"] for c in located))

    if sett_by_comm:
        (DATA / "settlements_geo.json").write_text(
            json.dumps({
                "source": "GeoNames (CC-BY) + CEC results",
                "total": sett_total,
                "located": sett_located,
                "by_community": sett_by_comm,
            }, ensure_ascii=False, indent=2),
            encoding="utf-8")
        print(f"Geocoded {sett_matched}/{sett_total} settlements "
              f"({sett_located} with coordinates) in {len(sett_by_comm)} communities")


if __name__ == "__main__":
    main()
