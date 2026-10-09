# Blend Player version inventory

This file tracks the Blend v5 version folders and the version metadata that can be verified from this checkout and its repository history. A folder name alone confirms a source snapshot exists; it does not establish a release date or prove that the build was published.

## Current checkout

The app version is **5.0.11** in `package.json` and `pwa-config.js`. The UI and web app manifests also identify Blend 5.0.11.

| Version field | Verified value | Source |
|---|---|---|
| App version | `5.0.11` | `package.json`, `pwa-config.js` |
| Asset version | `20261008-v5.0.11-issue13-information-readme-version` | `pwa-config.js` |
| Cache version | `20261008-v5.0.11-issue13-information-readme-version` | `pwa-config.js` |
| IndexedDB database | `player-blend-v1`, schema version `5` | `pwa-config.js` |

Asset and cache versions identify a static-app cache generation. They are not separate product releases. The parent repository's top-level `VERSION` describes that repository and is not the Blend app version.

## Version-folder history

| App version | Repository evidence | Release date or notes |
|---|---|---|
| 5.0.0 | Folder exists; page and manifest identify 5.0.0; no package file | No date or separate release notes verified |
| 5.0.1 | Folder suffix is 5.0.1, but page and manifest still identify 5.0.0; no package file | No distinct app version, date, or release notes verified |
| 5.0.2 | Folder suffix is 5.0.2, but page and manifest still identify 5.0.0; no package file | No distinct app version, date, or release notes verified |
| 5.0.3 | Folder suffix is 5.0.3, but page and manifest still identify 5.0.0; no package file | No distinct app version, date, or release notes verified |
| 5.0.4 | Folder suffix is 5.0.4, but page and manifest still identify 5.0.0; no package file | No distinct app version, date, or release notes verified |
| 5.0.5 | Folder suffix is 5.0.5, but page and manifest still identify 5.0.0; no package file | No distinct app version, date, or release notes verified |
| 5.0.6 | Folder, package, page, and manifest identify 5.0.6 | Release notes date this version 2026-06-25 |
| 5.0.7 | Package and page identify 5.0.7; manifest still identifies 5.0.6 | No independent date or release notes verified |
| 5.0.8 | Package, page, and manifest identify 5.0.8 | No independent date or release notes verified |
| 5.0.9 | Package and page identify 5.0.9; manifest still identifies 5.0.8 | No independent date or release notes verified |
| 5.0.10 | Package identifies 5.0.10; page identifies 5.0.9 and manifest identifies 5.0.8 | No independent date or release notes verified |
| 5.0.11 | Package, PWA config, page, and manifests identify 5.0.11; this is the current app version | Release notes date this version 2026-10-06 |

The 5.0.7–5.0.10 READMEs carry forward the 5.0.6 changelog entry but contain no separate release summary. Several older snapshots also have stale in-app or manifest labels. Dates and changes for these versions are left undocumented instead of inferred from folder names.
