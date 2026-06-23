#!/usr/bin/env python3
"""
Armenia 2026 Legislative Election Atlas — data pipeline.

Single source of truth: Central Electoral Commission (CEC) of Armenia.
  - Results by polling station : https://www.elections.am/File/ElectionResult?electionId=28826
  - Polling station registry   : https://www.elections.am/File/SubDistrictsToExcel?electionId=28826

This script joins the two official workbooks (results keyed by polling station,
registry providing marz / community / constituency) and produces clean, versioned
artefacts at every aggregation level: polling station -> community -> marz -> national.

Each election lives under data/<ELECTION>/ (default 2026; override with the
ELECTION environment variable). Outputs (all derived, reproducible):
  data/<ELECTION>/clean/stations.{parquet,csv}      full granular table (stations x parties)
  data/<ELECTION>/clean/communities.{parquet,csv}   aggregated by community
  data/<ELECTION>/clean/marz.{parquet,csv}          aggregated by marz (11 provinces)
  data/<ELECTION>/national.json                     national party totals + meta (for the site)
  data/<ELECTION>/marz.json                         per-marz totals, winner, margin, shares (for the map)
  data/<ELECTION>/parties.json                      trilingual party metadata + national result + best/worst marz
  data/<ELECTION>/meta.json                         provenance, timestamps, integrity checks
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import pathlib
import sys

import openpyxl
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
ELECTION = os.environ.get("ELECTION", "2026")
RAW = ROOT / "data" / ELECTION / "raw"
CLEAN = ROOT / "data" / ELECTION / "clean"
DATA = ROOT / "data" / ELECTION

RESULTS_XLSX = RAW / "cec_results_by_station.xlsx"
REGISTRY_XLSX = RAW / "cec_subdistricts.xlsx"

SOURCE = {
    "results_by_station": "https://www.elections.am/File/ElectionResult?electionId=28826",
    "polling_station_registry": "https://www.elections.am/File/SubDistrictsToExcel?electionId=28826",
    "authority": "Central Electoral Commission of the Republic of Armenia (elections.am)",
    "election": "National Assembly of Armenia — ordinary election, 7 June 2026",
    "boundaries": "geoBoundaries ARM ADM1 (CC-BY 4.0)",
}

# --- Administrative columns in the results workbook (0-indexed) ---
COL_TEC = 0           # Territorial Electoral Commission number
COL_STATION = 1       # Polling station code, e.g. "1/1"
COL_REGISTERED = 5    # Total number of voters (registered)
COL_PARTICIPANTS = 6  # Total number of participants (ballots cast)
COL_INVALID = 14      # Invalid ballots
COL_INACCURACY = 33   # Sum of inaccuracies

# --- Party columns (0-indexed in the results workbook) -> stable id + trilingual meta ---
# Order follows the official ballot order in the workbook (cols 15..32).
PARTIES = [
    # col, id, type, hy, en, fr, abbr, leader, bloc, family, color
    (29, "civil_contract", "party",
     "«Քաղաքացիական պայմանագիր» կուսակցություն", "Civil Contract", "Contrat civil",
     "ՔՊ / CC", "Nikol Pashinyan", "government",
     "liberal-reformist", "#F58220"),
    (17, "strong_armenia", "alliance",
     "«Ուժեղ Հայաստան» դաշինք", "Strong Armenia Alliance", "Alliance « Arménie forte »",
     "ՈՒՀ / SA", "Samvel Karapetyan", "opposition",
     "conservative-sovereigntist", "#C8102E"),
    (30, "armenia_alliance", "alliance",
     "«Հայաստան» դաշինք", "Armenia Alliance", "Alliance « Arménie »",
     "ՀԴ / AA", "Robert Kocharyan", "opposition",
     "national-conservative", "#1B3A6B"),
    (21, "prosperous_armenia", "party",
     "«Բարգավաճ Հայաստան» կուսակցություն", "Prosperous Armenia", "Arménie prospère",
     "ԲՀԿ / PA", "Gagik Tsarukyan", "below-threshold",
     "centrist-populist", "#E8A300"),
    (20, "wings_of_unity", "party",
     "«Միասնության թևեր» կուսակցություն", "Wings of Unity", "Ailes de l’unité",
     "ՄԹ / WU", "Mane Tandilyan", "below-threshold",
     "centrist", "#6A4C93"),
    (18, "meritocratic", "party",
     "Հայաստանի շնորհապետական կուսակցություն", "Meritocratic Party of Armenia", "Parti méritocratique d’Arménie",
     "ՀՇԿ / MP", None, "below-threshold",
     "technocratic", "#0F8B8D"),
    (28, "democracy_law_discipline", "party",
     "«Դեմոկրատիա, օրենք, կարգապահություն» կուսակցություն", "Democracy, Law and Discipline", "Démocratie, loi et discipline",
     "ԴՕԿ / DLD", None, "below-threshold",
     "law-and-order", "#7D8597"),
    (19, "new_power", "party",
     "«Նոր ուժ» ռեֆորմիստական կուսակցություն", "New Power Reformist Party", "Parti réformiste « Nouvelle Force »",
     "ՆՈՒ / NP", None, "below-threshold",
     "reformist", "#2A9D8F"),
    (16, "against_all", "party",
     "«Բոլորին դեմ եմ» ժողովրդավարական կուսակցություն", "“Against All” Democratic Party", "Parti démocratique « Contre tous »",
     "ԲԴԵ / AAll", None, "below-threshold",
     "protest", "#8D99AE"),
    (25, "hanrapetutyun", "party",
     "«Հանրապետություն» կուսակցություն", "Hanrapetutyun (Republic) Party", "Parti Hanrapetoutioun (République)",
     "Հանր / Rep", "Aram Sargsyan", "below-threshold",
     "liberal-republican", "#5B8C5A"),
    (32, "bright_armenia", "party",
     "«Լուսավոր Հայաստան» կուսակցություն", "Bright Armenia", "Arménie lumineuse",
     "ԼՀԿ / BA", "Edmon Marukyan", "below-threshold",
     "liberal", "#4895EF"),
    (31, "for_the_republic", "alliance",
     "«Հանուն Հանրապետության» ժողովրդավարության պաշտպանների դաշինք", "“In the Name of the Republic” Democracy Defenders Alliance",
     "Alliance « Au nom de la République »",
     "ՀՀ / NR", None, "below-threshold",
     "republican", "#9C6644"),
    (22, "national_democratic_pole", "party",
     "«Ազգային-ժողովրդավարական բևեռ» համահայկական կուսակցություն", "Pan-Armenian National Democratic Pole", "Pôle national-démocrate panarménien",
     "ԱԺԲ / NDP", None, "below-threshold",
     "national-democratic", "#BC6C25"),
    (27, "democratic_consolidation", "party",
     "«Ժողովրդավարական համախմբում» կուսակցություն", "Democratic Consolidation Party", "Consolidation démocratique",
     "ԺՀ / DC", None, "below-threshold",
     "centrist", "#A3B18A"),
    (24, "anc", "party",
     "«Հայ ազգային կոնգրես» կուսակցություն", "Armenian National Congress", "Congrès national arménien",
     "ՀԱԿ / ANC", "Levon Ter-Petrosyan", "below-threshold",
     "social-liberal", "#577590"),
    (26, "christian_democratic", "party",
     "Քրիստոնեա-ժողովրդավարական կուսակցություն", "Christian Democratic Party", "Parti chrétien-démocrate",
     "ՔԺԿ / CD", None, "below-threshold",
     "christian-democratic", "#B5838D"),
    (23, "kochari", "party",
     "«Քոչարի ազգային վերածնունդ և ազգի զարթոնք» կուսակցություն", "Kochari National Revival and Awakening", "Kochari — Renaissance nationale",
     "Քոչ / Koch", None, "below-threshold",
     "nationalist", "#6D6875"),
    (15, "reformists", "party",
     "Ռեֆորմիստների կուսակցություն", "Reformists Party", "Parti des réformistes",
     "Ռեֆ / Ref", None, "below-threshold",
     "reformist", "#B08968"),
]

PARTY_BY_COL = {p[0]: p[1] for p in PARTIES}
PARTY_IDS = [p[1] for p in PARTIES]
PARTY_META = {
    p[1]: dict(col=p[0], type=p[2], name_hy=p[3], name_en=p[4], name_fr=p[5],
               abbr=p[6], leader=p[7], bloc=p[8], family=p[9], color=p[10])
    for p in PARTIES
}

# Marz: Armenian label (registry) -> iso / trilingual names. ISO from geoBoundaries.
MARZ = {
    "Երևան":      ("AM-ER", "Yerevan", "Erevan", "Երևան"),
    "Արագածոտն":  ("AM-AG", "Aragatsotn", "Aragatsotn", "Արագածոտն"),
    "Արարատ":     ("AM-AR", "Ararat", "Ararat", "Արարատ"),
    "Արմավիր":    ("AM-AV", "Armavir", "Armavir", "Արմավիր"),
    "Գեղարքունիք": ("AM-GR", "Gegharkunik", "Guégharkounik", "Գեղարքունիք"),
    "Լոռի":       ("AM-LO", "Lori", "Lorri", "Լոռի"),
    "Կոտայք":     ("AM-KT", "Kotayk", "Kotayk", "Կոտայք"),
    "Շիրակ":      ("AM-SH", "Shirak", "Chirak", "Շիրակ"),
    "Սյունիք":    ("AM-SU", "Syunik", "Syunik", "Սյունիք"),
    "Վայոց ձոր":  ("AM-VD", "Vayots Dzor", "Vayots Dzor", "Վայոց ձոր"),
    "Տավուշ":     ("AM-TV", "Tavush", "Tavouch", "Տավուշ"),
}
# Reverse lookup keyed by English name -> (iso, en, fr, hy)
MARZ_INV = {v[1]: v for v in MARZ.values()}


def _num(v):
    if v is None or v == "":
        return 0
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


def read_results() -> pd.DataFrame:
    wb = openpyxl.load_workbook(RESULTS_XLSX, read_only=True, data_only=True)
    ws = wb.active
    records = []
    for row in ws.iter_rows(min_row=4, values_only=True):  # skip 2 title rows + header
        station = row[COL_STATION]
        if not station or "/" not in str(station):
            continue  # totals / blank rows
        rec = {
            "tec": str(row[COL_TEC]).zfill(2) if row[COL_TEC] else None,
            "station": str(station).strip(),
            "registered": _num(row[COL_REGISTERED]),
            "ballots_cast": _num(row[COL_PARTICIPANTS]),
            "invalid": _num(row[COL_INVALID]),
            "inaccuracy": _num(row[COL_INACCURACY]),
        }
        for col, pid in PARTY_BY_COL.items():
            rec[pid] = _num(row[col])
        records.append(rec)
    df = pd.DataFrame.from_records(records)
    df["valid"] = df[PARTY_IDS].sum(axis=1)
    return df


def read_registry() -> pd.DataFrame:
    wb = openpyxl.load_workbook(REGISTRY_XLSX, read_only=True, data_only=True)
    ws = wb.active
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        marz, community, settlement, constituency, station, address = r[:6]
        if not station:
            continue
        rows.append({
            "station": str(station).strip(),
            "marz_hy": (marz or "").strip(),
            "community_hy": (community or "").strip(),
            "constituency": str(constituency).strip() if constituency else None,
            "address": (address or "").strip(),
        })
    return pd.DataFrame.from_records(rows)


def winner_info(shares: dict) -> dict:
    ordered = sorted(shares.items(), key=lambda kv: kv[1]["votes"], reverse=True)
    top = ordered[0]
    second = ordered[1] if len(ordered) > 1 else (None, {"pct": 0})
    return {
        "winner": top[0],
        "winner_pct": top[1]["pct"],
        "margin": round(top[1]["pct"] - second[1]["pct"], 2),
        "runner_up": second[0],
        "order": [pid for pid, _ in ordered],
    }


def aggregate(df: pd.DataFrame, by: list[str]) -> pd.DataFrame:
    agg = {c: "sum" for c in PARTY_IDS}
    agg.update({"registered": "sum", "ballots_cast": "sum",
                "invalid": "sum", "valid": "sum"})
    g = df.groupby(by, as_index=False).agg(agg)
    g["stations"] = df.groupby(by, as_index=False).size()["size"].values
    return g


def shares_dict(row) -> dict:
    valid = max(int(row["valid"]), 1)
    out = {}
    for pid in PARTY_IDS:
        v = int(row[pid])
        out[pid] = {"votes": v, "pct": round(100 * v / valid, 3)}
    return out


def build():
    if not RESULTS_XLSX.exists() or not REGISTRY_XLSX.exists():
        sys.exit(f"Raw CEC workbooks missing in {RAW}/. Run scripts/fetch_source.sh first.")

    CLEAN.mkdir(parents=True, exist_ok=True)
    results = read_results()
    registry = read_registry()

    df = results.merge(registry, on="station", how="left")
    unmatched = df[df["marz_hy"].isna() | (df["marz_hy"] == "")]
    if len(unmatched):
        print(f"WARNING: {len(unmatched)} stations without marz mapping", file=sys.stderr)

    df["marz_iso"] = df["marz_hy"].map(lambda x: MARZ.get(x, (None,))[0])
    df["marz_en"] = df["marz_hy"].map(lambda x: MARZ.get(x, (None, None))[1])

    # --- station level (full granular) ---
    cols = (["tec", "station", "constituency", "marz_hy", "marz_en", "marz_iso",
             "community_hy", "address", "registered", "ballots_cast",
             "invalid", "valid"] + PARTY_IDS + ["inaccuracy"])
    stations = df[cols].copy()
    stations["turnout_pct"] = (100 * stations["ballots_cast"] /
                               stations["registered"].clip(lower=1)).round(2)
    stations.to_parquet(CLEAN / "stations.parquet", index=False)
    stations.to_csv(CLEAN / "stations.csv", index=False)

    # --- community level ---
    comm = aggregate(df, ["marz_en", "marz_iso", "community_hy"])
    comm["turnout_pct"] = (100 * comm["ballots_cast"] /
                           comm["registered"].clip(lower=1)).round(2)
    comm.to_parquet(CLEAN / "communities.parquet", index=False)
    comm.to_csv(CLEAN / "communities.csv", index=False)

    # --- marz level ---
    marz = aggregate(df, ["marz_en", "marz_iso", "marz_hy"])
    marz["turnout_pct"] = (100 * marz["ballots_cast"] /
                           marz["registered"].clip(lower=1)).round(2)
    marz.to_parquet(CLEAN / "marz.parquet", index=False)
    marz.to_csv(CLEAN / "marz.csv", index=False)

    # --- national ---
    nat_valid = int(results["valid"].sum())
    nat_cast = int(results["ballots_cast"].sum())
    nat_reg = int(results["registered"].sum())
    nat_invalid = int(results["invalid"].sum())
    national_parties = []
    for pid in PARTY_IDS:
        v = int(results[pid].sum())
        national_parties.append({
            "id": pid, "votes": v,
            "pct": round(100 * v / nat_valid, 4),
            **{k: PARTY_META[pid][k] for k in
               ("type", "name_hy", "name_en", "name_fr", "abbr",
                "leader", "bloc", "family", "color")},
        })
    national_parties.sort(key=lambda p: p["votes"], reverse=True)

    # seats (CEC final allocation, incl. national-minority + stabilising seats)
    seats = {"civil_contract": 64, "strong_armenia": 29, "armenia_alliance": 12}
    for p in national_parties:
        p["seats"] = seats.get(p["id"], 0)

    national = {
        "election": SOURCE["election"],
        "date": "2026-06-07",
        "threshold_party_pct": 4.0,
        "threshold_alliance_pct": 8.0,
        "registered": nat_reg,
        "ballots_cast": nat_cast,
        "valid": nat_valid,
        "invalid": nat_invalid,
        "turnout_pct": round(100 * nat_cast / nat_reg, 2),
        "total_seats": 105,
        "stations": int(len(results)),
        "parties": national_parties,
    }
    (DATA / "national.json").write_text(
        json.dumps(national, ensure_ascii=False, indent=2), encoding="utf-8")

    # --- per-marz JSON (winner, margin, shares, turnout) ---
    marz_json = {}
    party_marz_pct = {pid: {} for pid in PARTY_IDS}
    for _, row in marz.iterrows():
        sh = shares_dict(row)
        info = winner_info(sh)
        iso = row["marz_iso"]
        marz_json[iso] = {
            "iso": iso,
            "name_en": row["marz_en"],
            "name_hy": MARZ_INV[row["marz_en"]][3],
            "name_fr": MARZ_INV[row["marz_en"]][2],
            "registered": int(row["registered"]),
            "ballots_cast": int(row["ballots_cast"]),
            "valid": int(row["valid"]),
            "invalid": int(row["invalid"]),
            "turnout_pct": float(row["turnout_pct"]),
            "stations": int(row["stations"]),
            "winner": info["winner"],
            "winner_pct": info["winner_pct"],
            "runner_up": info["runner_up"],
            "margin": info["margin"],
            "order": info["order"],
            "shares": sh,
        }
        for pid in PARTY_IDS:
            party_marz_pct[pid][iso] = sh[pid]["pct"]
    (DATA / "marz.json").write_text(
        json.dumps(marz_json, ensure_ascii=False, indent=2), encoding="utf-8")

    # --- per-party JSON (national + per-marz pct + best/worst marz) ---
    parties_out = []
    for p in national_parties:
        pid = p["id"]
        pm = party_marz_pct[pid]
        ranked = sorted(pm.items(), key=lambda kv: kv[1], reverse=True)
        parties_out.append({
            **p,
            "by_marz": pm,
            "best_marz": ranked[0][0] if ranked else None,
            "worst_marz": ranked[-1][0] if ranked else None,
            "won_marz": [iso for iso, m in marz_json.items() if m["winner"] == pid],
        })
    (DATA / "parties.json").write_text(
        json.dumps(parties_out, ensure_ascii=False, indent=2), encoding="utf-8")

    # --- meta / provenance + integrity checks ---
    meta = {
        "generated_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "source": SOURCE,
        "marzer": {iso: {"en": en, "fr": fr, "hy": hy}
                   for hy_, (iso, en, fr, hy) in MARZ.items()},
        "integrity": {
            "stations_parsed": int(len(results)),
            "national_valid_votes": nat_valid,
            "national_ballots_cast": nat_cast,
            "civil_contract_votes": int(results["civil_contract"].sum()),
            "strong_armenia_votes": int(results["strong_armenia"].sum()),
            "armenia_alliance_votes": int(results["armenia_alliance"].sum()),
        },
        "files": {
            "stations": [f"data/{ELECTION}/clean/stations.parquet", f"data/{ELECTION}/clean/stations.csv"],
            "communities": [f"data/{ELECTION}/clean/communities.parquet", f"data/{ELECTION}/clean/communities.csv"],
            "marz": [f"data/{ELECTION}/clean/marz.parquet", f"data/{ELECTION}/clean/marz.csv"],
        },
    }
    (DATA / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # --- console summary ---
    print("OK — parsed", len(results), "polling stations")
    print(f"   national turnout : {national['turnout_pct']}%  "
          f"({nat_cast:,} / {nat_reg:,})")
    for p in national_parties[:5]:
        print(f"   {p['name_en']:<28} {p['votes']:>9,}  {p['pct']:>6.2f}%  "
              f"{p['seats']} seats")
    print("   marz winners:", {iso: m["winner"] for iso, m in marz_json.items()})


if __name__ == "__main__":
    build()
