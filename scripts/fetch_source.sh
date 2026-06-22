#!/usr/bin/env bash
# Fetch the official single-source-of-truth workbooks from the Armenian CEC.
# Re-run to refresh. Files are committed to data/raw/ for full reproducibility.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw

EID=28826  # National Assembly election, 7 June 2026 (elections.am internal id)
BASE="https://www.elections.am/File"

echo "Fetching CEC results by polling station..."
curl -fsSL "$BASE/ElectionResult?electionId=$EID"      -o data/raw/cec_results_by_station.xlsx
echo "Fetching CEC polling-station registry (marz / community)..."
curl -fsSL "$BASE/SubDistrictsToExcel?electionId=$EID"  -o data/raw/cec_subdistricts.xlsx

ls -la data/raw
echo "Done. Now run: python scripts/build_data.py"
