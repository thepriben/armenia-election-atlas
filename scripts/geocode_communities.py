#!/usr/bin/env python3
"""
Attach coordinates to the 81 CEC communities using the GeoNames gazetteer
(free, CC-BY). Produces data/communities_geo.json for the zoomable bubble map:
each community as a point (electorate-sized, winner-coloured) with its top results.

GeoNames AM dump: https://download.geonames.org/export/dump/AM.zip  (AM.txt, TSV)
Columns: geonameid, name, asciiname, alternatenames, lat, lon, fclass, fcode, ...
"""
from __future__ import annotations

import csv
import json
import pathlib
import sys

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEONAMES = pathlib.Path("/tmp/AM.txt")
COMMUNITIES = ROOT / "data" / "clean" / "communities.parquet"

# feature-class preference: populated places, then admin areas
FCLASS_RANK = {"P": 0, "A": 1, "L": 3, "T": 3, "H": 4, "S": 2, "V": 3, "R": 3}


def load_geonames():
    """name(Armenian or latin) -> list of (rank, pop, lat, lon)."""
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
            pop = int(row[14]) if row[14].isdigit() else 0
            rank = FCLASS_RANK.get(fclass, 5)
            names = {row[1], row[2]}
            names.update(n for n in row[3].split(",") if n)
            for nm in names:
                idx.setdefault(nm.strip(), []).append((rank, -pop, lat, lon, fclass))
    for nm in idx:
        idx[nm].sort()
    return idx


# Communities GeoNames cannot resolve (ligature edge cases / Yerevan districts).
MANUAL = {
    "Նուբարաշեն": (40.1296, 44.5406),  # Nubarashen, district of Yerevan
    "Արեվուտ": (40.3253, 44.6190),     # Arevut community (Kotayk), Nor Hachn area
}


def normalize(s: str) -> str:
    return (s or "").strip().replace(" յ", "յ")


def _variants(name):
    yield name
    # Armenian ligature: "եվ" <-> "և"
    yield name.replace("եվ", "և")
    yield name.replace("և", "եվ")


def match(name, idx):
    if name in MANUAL:
        lat, lon = MANUAL[name]
        return lat, lon, "M"
    for v in _variants(name):
        cands = idx.get(v)
        if cands:
            r = cands[0]
            return r[2], r[3], r[4]
    for part in (name.split()[0], name.split("-")[0]):
        c = idx.get(part)
        if c:
            return c[0][2], c[0][3], c[0][4]
    return None


def main():
    if not GEONAMES.exists():
        sys.exit("Missing /tmp/AM.txt — download GeoNames AM.zip first.")
    parties = json.loads((ROOT / "data" / "parties.json").read_text())
    pids = [p["id"] for p in parties]
    color = {p["id"]: p["color"] for p in parties}

    df = pd.read_parquet(COMMUNITIES)
    idx = load_geonames()

    out, matched = [], 0
    for _, r in df.iterrows():
        votes = {pid: int(r[pid]) for pid in pids if pid in r}
        order = sorted(votes, key=votes.get, reverse=True)
        valid = max(int(r["valid"]), 1)
        winner = order[0]
        top = [{"id": pid, "pct": round(100 * votes[pid] / valid, 1)} for pid in order[:3]]
        m = match(normalize(r["community_hy"]), idx)
        if m:
            matched += 1
        out.append({
            "community": r["community_hy"],
            "marz_en": r["marz_en"],
            "marz_iso": r["marz_iso"],
            "registered": int(r["registered"]),
            "turnout_pct": float(r["turnout_pct"]),
            "valid": valid,
            "winner": winner,
            "winner_color": color[winner],
            "margin": round(top[0]["pct"] - (top[1]["pct"] if len(top) > 1 else 0), 1),
            "top": top,
            "lat": m[0] if m else None,
            "lon": m[1] if m else None,
        })

    located = [c for c in out if c["lat"] is not None]
    (ROOT / "data" / "communities_geo.json").write_text(
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


if __name__ == "__main__":
    main()
