# Armenia Election Atlas

A **trilingual (EN / ՀՅ / FR)** geographic atlas of Armenia's parliamentary
elections — built to be explored and shared by link, not just read.

The atlas is designed to grow into a multi-election archive. **For now it covers the
7 June 2026 election only**; earlier elections are planned and will be added later.

For 2026, Civil Contract won a second outright majority and carried **all eleven
provinces**. The atlas focuses on the geography of that result: the margin of victory and
the party scores, province by province and community by community.

**Live site:** `https://thepriben.github.io/armenia-election-atlas/`

## What's inside

- **National result** — vote bars with the 4% / 8% thresholds and a 105-seat hemicycle.
- **The map** — a D3 choropleth of the 11 *marzer* with four metrics: winner, **margin of
  victory**, turnout, and **party share** (any of the 18 forces). Click a province for a
  full breakdown; every view is encoded in the **URL** so you can share an exact state.
- **Zoom** — a pan-and-zoom bubble map down to the **community** level (81 communities,
  geocoded), the closest view to the polling places.
- **Parties** — neutral, trilingual profiles cross-referenced to **Wikidata** + Wikipedia.
- **Data** — sortable tables and downloads (**Parquet** / CSV / GeoJSON), derived from the
  **2,005 polling stations** in the official CEC workbooks.

## Single source of truth

All results come from the **Central Electoral Commission of Armenia** (`elections.am`):

| File | Source |
|---|---|
| Results by polling station | `https://www.elections.am/File/ElectionResult?electionId=28826` |
| Polling-station registry (marz / community) | `https://www.elections.am/File/SubDistrictsToExcel?electionId=28826` |

Province boundaries: **geoBoundaries** ARM ADM1 (CC-BY 4.0).
Community coordinates: **GeoNames** (CC-BY).
Identifiers and multilingual labels: **Wikidata**.

## Reproducible pipeline

```bash
python -m venv .venv && source .venv/bin/activate
pip install pandas pyarrow openpyxl requests

bash   scripts/fetch_source.sh        # download the two official CEC workbooks
python scripts/build_data.py          # join station→community→marz→nation; emit Parquet/CSV/JSON
python scripts/geocode_communities.py # attach GeoNames coordinates (needs /tmp/AM.txt)
python scripts/enrich_links.py        # Wikidata QIDs + Wikipedia links/labels (EN/HY/FR)
```

Outputs land in `data/` (JSON for the site) and `data/clean/` (Parquet + CSV).

**Note on totals.** The per-station tabulation sums to ~0.05% below the certified national
figures because it excludes the small electronic vote and three annulled stations. The
atlas shows the certified national totals and seat allocation, and uses the per-station
data for everything geographic.

## Run locally

```bash
python -m http.server 8000   # then open http://localhost:8000
```

No build step. The site is plain ES modules + D3 (from CDN) + hyparquet for in-browser Parquet.

## Deploy to GitHub Pages

1. Push to `github.com/thepriben/armenia-election-atlas`.
2. Settings → Pages → *Deploy from a branch* → `main` / root.
3. A `.nojekyll` file is included so `data/` and `.parquet` files are served as-is.

## License

Code: **MIT**. Data: see sources above (CEC public; geoBoundaries CC-BY; GeoNames CC-BY; ArmStat).
