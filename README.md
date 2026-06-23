# Armenia Election Atlas

A **trilingual (EN / ՀՅ / FR)** geographic atlas of Armenia's parliamentary
elections — built to be explored and shared by link, not just read.

A **portal** designed to grow into a multi-election archive: pick an election from the
switcher in the header and the whole site re-renders for that vote. **It currently covers
the 2021 and 2026 parliamentary elections**; earlier votes are planned and appear as
*coming soon* until their data lands.

In both 2021 and 2026, Civil Contract won an outright majority and carried **all eleven
provinces**. The atlas focuses on the geography of each result: the margin of victory and
the party scores, province by province and community by community.

**Live site:** <https://hayntrutyun.info/> · mirror: `https://thepriben.github.io/armenia-election-atlas/`

## What's inside

- **Election switcher** — choose the election in the header; the selection is part of the
  shareable **URL**, so a link can pin both the election and the exact view.
- **National result** — vote bars with the 4% / 8% thresholds and a 105-seat hemicycle.
- **The map** — a D3 choropleth of the 11 *marzer* with four metrics: winner, **margin of
  victory**, turnout, and **party share**. Click a province for a full breakdown; every
  view is encoded in the **URL** so you can share an exact state.
- **Zoom** — a pan-and-zoom bubble map down to the **community** level (geocoded), the
  closest view to the polling places.
- **Parties** — neutral, trilingual profiles cross-referenced to **Wikidata** + Wikipedia.
- **Data** — sortable tables and downloads (**Parquet** / CSV / GeoJSON), derived from the
  official CEC workbooks (2026: 2,005 stations, 18 forces, 81 communities; 2021: 2,008
  stations, 25 forces, 513 communities).

## Single source of truth

All results come from the **Central Electoral Commission of Armenia** (`elections.am`):

| File | Source (`electionId`: 2026 = `28826`, 2021 = `27697`) |
|---|---|
| Results by polling station | `https://www.elections.am/File/ElectionResult?electionId=<id>` |
| Polling-station registry (marz / community) | `https://www.elections.am/File/SubDistrictsToExcel?electionId=<id>` |

Province boundaries: **geoBoundaries** ARM ADM1 (CC-BY 4.0).
Community coordinates: **GeoNames** (CC-BY).
Identifiers and multilingual labels: **Wikidata**.

## Reproducible pipeline

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

bash   scripts/fetch_source.sh        # download the two official CEC workbooks
python scripts/build_data.py          # join station→community→marz→nation; emit Parquet/CSV/JSON
python scripts/geocode_communities.py # attach GeoNames coordinates (needs /tmp/AM.txt)
python scripts/enrich_links.py        # Wikidata QIDs + Wikipedia links/labels (EN/HY/FR)
```

All scripts target one election at a time, selected with the `ELECTION`
environment variable (default `2026`), e.g. `ELECTION=2021 python scripts/build_data.py`.

## Data layout

The atlas is a multi-election archive. Each election has its own folder; shared,
election-independent assets (province boundaries) live at the `data/` root.

```
data/
  elections.json            # index of elections (id, date, status, names)
  armenia-marz.geojson      # shared: province boundaries (geoBoundaries)
  2026/
    national.json  marz.json  parties.json  links.json  meta.json
    party_profiles.json  communities_geo.json
    clean/  stations.{parquet,csv}  communities.{parquet,csv}  marz.{parquet,csv}
    raw/    original CEC workbooks
  2021/                       # same structure as 2026/
```

`data/elections.json` lists every election, its `date`, trilingual `name`, and
`status` (`available` or `upcoming`). The header switcher and the site's default
election are driven entirely by this file. **Both `2021` and `2026` are `available`;
`2026` is the default.**

## Add an election

1. Find the election's `electionId` on `elections.am` (the `<option value=...>` in the
   parliamentary-elections page; e.g. 2021 = `27697`, 2026 = `28826`).
2. Add a config block for the year to the `ELECTIONS` dict in `scripts/build_data.py`:
   the ballot (party) **column indices** from the results workbook, trilingual party
   metadata, thresholds, seat allocation and `election_id`. Add the matching party/leader
   Wikipedia titles to `TITLES_BY_ELECTION` in `scripts/enrich_links.py`.
3. Generate the per-election dataset (everything lands under `data/<year>/`):

   ```bash
   export ELECTION=2021
   bash   scripts/fetch_source.sh
   python scripts/build_data.py
   python scripts/geocode_communities.py
   python scripts/enrich_links.py
   ```

4. Add the election to `data/elections.json` with `"status": "upcoming"`; flip it to
   `"available"` once the data is in and verified. Set `"default"` if it should be the
   election shown on first load.

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
