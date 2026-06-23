"""Refresh scripts/osm_cache.json from OpenStreetMap (Nominatim).

Geocoding normally runs offline against GeoNames + this committed cache. A small
set of Armenian villages is missing from GeoNames; this script looks them up on
Nominatim and stores the coordinate nearest each community seat. Run it only when
the village set changes:

    python scripts/refresh_osm_cache.py

It reads the still-unmatched settlements from every data/<year>/settlements_geo.json
(so run the geocoder first), queries Nominatim at <=1 req/s with a descriptive
User-Agent, and writes the cache keyed by "<marz_en>|<normalized name>".
"""
import json
import math
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "osm_cache.json"
UA = "armenia-election-atlas/1.0 (https://github.com/thepriben; village geocoding)"
MAX_KM = 30.0


def _km(a, b, c, d):
    return math.hypot((a - c) * 111.0, (b - d) * 85.0)


def _clean(name):
    toks = name.split()
    if toks and toks[-1] in ("գյուղ", "քաղաք", "կայարան", "ավան", "ք"):
        toks = toks[:-1]
    return " ".join(toks).strip()


def collect_targets():
    """Map "<marz_en>|<clean name>" -> (query, parent_lat, parent_lon)."""
    targets = {}
    for ydir in sorted((ROOT / "data").glob("*/settlements_geo.json")):
        coms = {
            f"{c['marz_iso']}|{c['community']}": c
            for c in json.loads((ydir.parent / "communities_geo.json").read_text())["communities"]
        }
        sett = json.loads(ydir.read_text())
        for key, arr in sett["by_community"].items():
            parent = coms.get(key)
            if not parent or parent.get("lat") is None:
                continue
            for x in arr:
                if x.get("lat") is not None:
                    continue
                q = _clean(x["locality_hy"])
                targets[f"{x['marz_en']}|{q}"] = (q, parent["lat"], parent["lon"])
    return targets


def query(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q + ", Armenia", "format": "jsonv2", "limit": "10", "countrycodes": "am"}
    )
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=20))


def main():
    targets = collect_targets()
    cache = {}
    for key, (q, plat, plon) in sorted(targets.items()):
        try:
            results = query(q)
        except Exception as exc:  # noqa: BLE001
            print(f"ERR {key}: {exc}")
            results = []
        best = None
        for r in results:
            la, lo = float(r["lat"]), float(r["lon"])
            d = _km(plat, plon, la, lo)
            if d <= MAX_KM and (best is None or d < best[2]):
                best = (round(la, 5), round(lo, 5), d)
        cache[key] = {"lat": best[0], "lon": best[1]} if best else None
        print(f"{'OK' if best else '--'} {key} -> {cache[key]}")
        time.sleep(1.1)
    CACHE.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )
    filled = sum(1 for v in cache.values() if v)
    print(f"Wrote {filled}/{len(cache)} cached coordinates to {CACHE}")


if __name__ == "__main__":
    main()
