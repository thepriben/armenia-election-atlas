#!/usr/bin/env bash
# Fetch the official single-source-of-truth workbooks from the Armenian CEC.
# Re-run to refresh. Files are committed to data/$ELECTION/raw/ for reproducibility.
set -euo pipefail
cd "$(dirname "$0")/.."

ELECTION="${ELECTION:-2026}"
RAW="data/$ELECTION/raw"
mkdir -p "$RAW"

# elections.am internal electionId per National Assembly election.
case "$ELECTION" in
  2026) EID=28826 ;;  # ordinary election, 7 June 2026
  2021) EID=27697 ;;  # early election, 20 June 2021
  *) echo "Unknown ELECTION=$ELECTION; add its electionId to scripts/fetch_source.sh" >&2; exit 1 ;;
esac
BASE="https://www.elections.am/File"

echo "Fetching CEC results by polling station..."
curl -fsSL "$BASE/ElectionResult?electionId=$EID"      -o "$RAW/cec_results_by_station.xlsx"
echo "Fetching CEC polling-station registry (marz / community)..."
curl -fsSL "$BASE/SubDistrictsToExcel?electionId=$EID"  -o "$RAW/cec_subdistricts.xlsx"

ls -la "$RAW"
echo "Done. Now run: python scripts/build_data.py"
