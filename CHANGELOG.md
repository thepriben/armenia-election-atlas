# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-06-23

First public release: a trilingual (EN / HY / FR) interactive geographic atlas of
Armenia's parliamentary elections, built on official CEC data and served at
[hayntrutyun.info](https://hayntrutyun.info).

### Added

- **Multi-election portal** covering the **2021** early and **2026** parliamentary
  elections, with an interactive election switcher in the header.
- **Trilingual UI** (English, Armenian, French) with a language switcher and a
  light/dark theme toggle. Defaults to Armenian.
- **National results**: vote-share bars, a 105-seat hemicycle, and a full national
  table with per-party seats and leaders.
- **Map of the vote**: a province (marz) choropleth, per-party maps, and a clickable
  panel to inspect each province.
- **Community bubble map** built on the ~81 consolidated communities, with pixel
  clustering and a compact per-point tooltip.
- **Settlement drill-down**: click a community to reveal its individual localities;
  a real zoom-out gesture returns to the full map.
- **Geocoding pipeline** (GeoNames + an OpenStreetMap/Nominatim fallback cache) that
  locates **100 % of settlements** (930/930 in 2026, 923/923 in 2021), with
  build-time province-integrity checks.
- **Data downloads**: clean Parquet and CSV for marz, communities, settlements and
  polling stations.
- **OpenStreetMap audit page** (`verify.html`): a Leaflet view overlaying every
  community and settlement on real tiles, with a 2021/2026 switch, marz filter,
  name search and settlement→seat link layer. Cross-linked with the main atlas.
- **Overseas electronic-vote note**, shown per election when figures are available.
- Custom domain `hayntrutyun.info`.

### Changed

- Reframed the project from a single 2026 page into a multi-election portal, with
  per-election data folders (`data/<year>/`) and a shared `elections.json` index.
- Focused the experience on the vote itself, trimming earlier context, correlation
  and forensics sections in favour of clearer, sober copy.
- Re-aggregated the 2021 results to the same ~81 consolidated communities as 2026
  for consistent granularity and map naming.
- Hero title, brand and document title now reflect the currently selected election.

### Fixed

- Corrected severely mislocated 2021 communities and disambiguated same-province
  homonyms (e.g. the two "Baghramyan") using their settlements' centroid.
- Kept all map bubbles inside Armenia at every zoom level by anchoring them to their
  true projected position and bounding the declustering offset in screen pixels.
- Smoothed wheel zooming by throttling cluster re-rendering to one frame.
- Fixed the national table overflowing sideways and refreshed hero stats on language
  change.
