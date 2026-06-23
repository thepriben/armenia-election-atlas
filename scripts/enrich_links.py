#!/usr/bin/env python3
"""
Enrich entities (parties, leaders, marzer, the election) with Wikidata QIDs and
Wikipedia article titles in EN / HY / FR, via the MediaWiki API.

Writes data/<ELECTION>/links.json:
  { "<id>": { "qid": "Q...", "wikidata": "https://www.wikidata.org/wiki/Q...",
              "wikipedia": { "en": {"title","url"}, "hy": {...}, "fr": {...} } } }

Resolution strategy: start from a curated English Wikipedia title (most stable),
then read langlinks (hy, fr) and the linked Wikidata item (pageprops.wikibase_item).
Missing language editions are simply omitted — nothing is fabricated.
"""
from __future__ import annotations

import json
import os
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
ELECTION = os.environ.get("ELECTION", "2026")
DATA = ROOT / "data" / ELECTION
API = "https://en.wikipedia.org/w/api.php"
UA = "ArmeniaElectionAtlas2026/1.0 (https://github.com/thepriben; data enrichment)"

# id -> English Wikipedia title (None => skip, no reliable article).
# The 11 marzer are shared across elections; party/leader/election entries differ.
MARZ_TITLES = {
    "AM-ER": "Yerevan",
    "AM-AG": "Aragatsotn Province",
    "AM-AR": "Ararat Province",
    "AM-AV": "Armavir Province",
    "AM-GR": "Gegharkunik Province",
    "AM-LO": "Lori Province",
    "AM-KT": "Kotayk Province",
    "AM-SH": "Shirak Province",
    "AM-SU": "Syunik Province",
    "AM-VD": "Vayots Dzor Province",
    "AM-TV": "Tavush Province",
}

TITLES_BY_ELECTION = {
    "2026": {
        # the election
        "election": "2026 Armenian parliamentary election",
        # parties / alliances
        "civil_contract": "Civil Contract",
        "strong_armenia": "Strong Armenia",
        "armenia_alliance": "Armenia Alliance",
        "prosperous_armenia": "Prosperous Armenia",
        "wings_of_unity": "Wings of Unity",
        "bright_armenia": "Bright Armenia",
        "anc": "Armenian National Congress",
        "hanrapetutyun": "Hanrapetutyun",
        "new_power": None,
        "meritocratic": None,
        "democracy_law_discipline": None,
        "against_all": None,
        "for_the_republic": None,
        "national_democratic_pole": None,
        "democratic_consolidation": None,
        "christian_democratic": None,
        "kochari": None,
        "reformists": None,
        # leaders
        "leader_pashinyan": "Nikol Pashinyan",
        "leader_karapetyan": "Samvel Karapetyan (businessman)",
        "leader_kocharyan": "Robert Kocharyan",
        "leader_tsarukyan": "Gagik Tsarukyan",
        "leader_ter_petrosyan": "Levon Ter-Petrosyan",
        "leader_marukyan": "Edmon Marukyan",
        "leader_sargsyan": "Aram Sargsyan",
        "leader_tandilyan": "Mane Tandilyan",
    },
    "2021": {
        # the election
        "election": "2021 Armenian parliamentary election",
        # parties / alliances (only those with reliable EN articles)
        "civil_contract": "Civil Contract",
        "armenia_alliance": "Armenia Alliance",
        "i_have_honor": "I Have Honor Alliance",
        "prosperous_armenia": "Prosperous Armenia",
        "bright_armenia": "Bright Armenia",
        "anc": "Armenian National Congress",
        "hanrapetutyun": "Hanrapetutyun",
        "european": "European Party of Armenia",
        "democratic_party": "Democratic Party of Armenia",
        # leaders
        "leader_pashinyan": "Nikol Pashinyan",
        "leader_kocharyan": "Robert Kocharyan",
        "leader_vanetsyan": "Artur Vanetsyan",
        "leader_tsarukyan": "Gagik Tsarukyan",
        "leader_marukyan": "Edmon Marukyan",
        "leader_ter_petrosyan": "Levon Ter-Petrosyan",
        "leader_sargsyan": "Aram Sargsyan",
    },
}

if ELECTION not in TITLES_BY_ELECTION:
    raise SystemExit(f"Unknown ELECTION={ELECTION!r}; known: {', '.join(TITLES_BY_ELECTION)}")

EN_TITLES = {**TITLES_BY_ELECTION[ELECTION], **MARZ_TITLES}


def api_get(params: dict) -> dict:
    params = {**params, "format": "json"}
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def wiki_url(lang: str, title: str) -> str:
    return f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))


def resolve(title: str) -> dict | None:
    data = api_get({
        "action": "query", "prop": "langlinks|pageprops",
        "titles": title, "lllang": "hy", "lllimit": "max",
        "ppprop": "wikibase_item", "redirects": "1",
    })
    pages = data.get("query", {}).get("pages", {})
    page = next(iter(pages.values()), {})
    if "missing" in page:
        return None
    resolved_title = page.get("title", title)
    out = {"wikipedia": {"en": {"title": resolved_title, "url": wiki_url("en", resolved_title)}}}
    qid = page.get("pageprops", {}).get("wikibase_item")
    if qid:
        out["qid"] = qid
        out["wikidata"] = "https://www.wikidata.org/wiki/" + qid
    for ll in page.get("langlinks", []):
        if ll.get("lang") == "hy":
            out["wikipedia"]["hy"] = {"title": ll["*"], "url": wiki_url("hy", ll["*"])}
    # French separately (one langlinks call is limited to a single lang here)
    data_fr = api_get({
        "action": "query", "prop": "langlinks", "titles": resolved_title,
        "lllang": "fr", "lllimit": "max", "redirects": "1",
    })
    p_fr = next(iter(data_fr.get("query", {}).get("pages", {}).values()), {})
    for ll in p_fr.get("langlinks", []):
        if ll.get("lang") == "fr":
            out["wikipedia"]["fr"] = {"title": ll["*"], "url": wiki_url("fr", ll["*"])}
    return out


WD_API = "https://www.wikidata.org/w/api.php"


def fetch_labels(qids: list[str]) -> dict:
    """Authoritative multilingual labels (graphies) straight from Wikidata."""
    out = {}
    for i in range(0, len(qids), 45):
        batch = qids[i:i + 45]
        url = WD_API + "?" + urllib.parse.urlencode({
            "action": "wbgetentities", "ids": "|".join(batch),
            "props": "labels", "languages": "en|hy|fr", "format": "json",
        })
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        for qid, ent in data.get("entities", {}).items():
            labels = ent.get("labels", {})
            out[qid] = {lang: labels[lang]["value"]
                        for lang in ("en", "hy", "fr") if lang in labels}
        time.sleep(0.2)
    return out


def main():
    links = {}
    for eid, title in EN_TITLES.items():
        if not title:
            continue
        try:
            res = resolve(title)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {eid} ({title}): {exc}")
            res = None
        if res:
            links[eid] = res
            langs = ",".join(res["wikipedia"].keys())
            print(f"  ✓ {eid:<22} {res.get('qid','-'):<10} [{langs}]")
        else:
            print(f"  – {eid:<22} no article for '{title}'")
        time.sleep(0.2)

    # Central Wikidata graphies (labels) in en/hy/fr for every resolved QID.
    qids = sorted({v["qid"] for v in links.values() if "qid" in v})
    print(f"\nFetching Wikidata labels for {len(qids)} items...")
    labels = fetch_labels(qids)
    for v in links.values():
        if v.get("qid") in labels:
            v["labels"] = labels[v["qid"]]

    (DATA / "links.json").write_text(
        json.dumps(links, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote data/{ELECTION}/links.json with {len(links)} entities, "
          f"{len(labels)} label sets")


if __name__ == "__main__":
    main()
