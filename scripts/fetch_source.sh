#!/usr/bin/env bash
# Fetch the official single-source-of-truth workbooks from the Armenian CEC.
# Re-run to refresh. Files are committed to data/$ELECTION/raw/ for reproducibility.
set -euo pipefail
cd "$(dirname "$0")/.."

ELECTION="${ELECTION:-2026}"
RAW="data/$ELECTION/raw"
mkdir -p "$RAW"

EID=28826  # National Assembly election, 7 June 2026 (elections.am internal id)
BASE="https://www.elections.am/File"

echo "Fetching CEC results by polling station..."
curl -fsSL "$BASE/ElectionResult?electionId=$EID"      -o "$RAW/cec_results_by_station.xlsx"
echo "Fetching CEC polling-station registry (marz / community)..."
curl -fsSL "$BASE/SubDistrictsToExcel?electionId=$EID"  -o "$RAW/cec_subdistricts.xlsx"

ls -la "$RAW"
echo "Done. Now run: python scripts/build_data.py"
