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


# Communities GeoNames cannot resolve (ligature edge cases / Yerevan districts /
# consolidated municipalities named differently from their seat settlement).
MANUAL = {
    "Նուբարաշեն": (40.1296, 44.5406, "Nubarashen", "Nubarashen"),
    "Արեվուտ": (40.3253, 44.6190, "Arevut", "Arevut"),
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


def match(name, marz_en, idx):
    """Resolve a community to (lat, lon, fclass, en, fr)."""
    if name in MANUAL:
        lat, lon, en, fr = MANUAL[name]
        return lat, lon, "M", en, fr
    target = MARZ_ADM1.get(marz_en)
    for v in _variants(name):
        cands = idx.get(v)
        if not cands:
            continue
        in_prov = [c for c in cands if c[5] == target]
        if in_prov:
            c = in_prov[0]
            return c[2], c[3], c[4], c[6], c[7]
    return None


def spread_overlaps(out):
    """Village/town twins (e.g. 'Արարատ գյուղ' + 'Արարատ քաղաք') resolve to the
    same gazetteer point. Nudge exact duplicates onto a small deterministic ring
    (~1 km) so every bubble stays individually visible and clickable."""
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

    out, matched = [], 0
    for _, r in df.iterrows():
        votes = {pid: int(r[pid]) for pid in pids if pid in r}
        order = sorted(votes, key=votes.get, reverse=True)
        valid = max(int(r["valid"]), 1)
        winner = order[0]
        top = [{"id": pid, "pct": round(100 * votes[pid] / valid, 1)} for pid in order[:3]]
        hy = r["community_hy"]
        m = match(normalize(hy), r["marz_en"], idx)
        en = fr = None
        if m:
            matched += 1
            en, fr = m[3], m[4]
        same_marz = hy == marz_hy.get(r["marz_en"])
        out.append({
            "community": hy,
            "community_hy": hy,
            "community_en": en or hy,
            "community_fr": fr or en or hy,
            "same_as_marz": same_marz,
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

    spread_overlaps(out)
    located = [c for c in out if c["lat"] is not None]
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


if __name__ == "__main__":
    main()
