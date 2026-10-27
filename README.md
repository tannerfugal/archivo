# Archivo Fork

A fork of [noar-justedit/archivo](https://github.com/noar-justedit/archivo), based on v1.4.0. Catalog archive drives once and search them while they are disconnected.

## Development polish (unreleased)

- Ranked duplicate folder areas with coverage, verified/potential redundant space, nested breakdowns, other copy locations and guarded bulk file selection.
- Cooperative shared-catalog saves, stale-edit protection and update/reload notices. See [shared server setup](docs/SHARED_CATALOGS.md).

- Compact drive managers for schedules, duplicate comparisons and bulk organization: search, category/location filters, Select shown, retained hidden selections and bounded lists for large libraries.
- Schedule summaries, collapsible source links, preserved drafts while linking or switching tools, and live duplicate cleanup counts with survivor/network guards.

These changes are available from source. Previously downloaded beta 2 installers predate this polish pass.

## Added in 1.5.0 beta 2

- Independent Category and Physical location trees with bulk assignment and shared view scopes.
- Nested storage treemaps with four visible levels, wrapper-folder traversal, bounded aggregation, and paginated largest-file/folder lists.
- Expandable content-match groups with whole-group pagination and persistent explicit selections.
- Offline worker search with exact filenames, modified/created date ranges, drive, path, byte ranges, sorting and complete paginated counts.
- One Add disk dialog for mounted volumes, server shares and chosen folders; independent targeted Reveal workers and timing diagnostics.

## Added in 1.5.0 beta 1

- Local source bindings identify volumes and server folders without relying on drive labels.
- Background scheduled rescans for selected saved catalogs: intervals, daily times, or selected weekdays; automatic saves with five backups.
- Zoomable offline storage map, largest-item list, scan age, and logical size totals.
- Duplicate candidates from catalog metadata, full SHA-256 verification for connected sources, CSV reports, and guarded OS Trash cleanup that retains a verified copy.
- Mac menu bar / Windows tray, optional launch at login, cancellation, and recent activity.

Use existing OS-connected server shares. Network duplicate cleanup is inspection-only. Schedules stop when the app is explicitly quit.

## Install and test

See **[TESTING.md](TESTING.md)** for setup, source linking, schedules, duplicate cleanup, backups, and physical hardware checks.

[Download CI artifacts](https://github.com/tannerfugal/archivo/actions) from the Test builds workflow. Mac ARM64 and Windows x64 packages are built without publishing a public release. CI packages are unsigned; a local Developer ID signed Mac build may be supplied separately. Beta builds disable update prompts and do not take over the default `.archivo` association.

Upstream catalogs remain readable. Source bindings and schedules live in this fork’s local application data, independently on each computer, and are never imported from catalogs.

## Build from source

Requires Node.js 22.12 or newer; `.nvmrc` selects Node 22. No additional production npm dependencies.

```sh
npm ci
npm run check
npm start
npm run test:unit
npm test
npm run test:features
npm run test:polish
npm run test:advanced
npm run test:background
npm run build:mac:test
npm run build:win
```

`npm test` is the upstream Electron regression suite. `test:features` runs real UI interactions with Playwright’s Electron driver and disposable files. It includes an OS Trash check using only a generated duplicate. `test:unit` covers identity matching, containment, schedule arithmetic, backups, save conflicts, incomplete scans, and verified cleanup.

`test:polish` checks a disposable 30-drive library at 1280×820 and 1100×700, including filtered bulk selection, schedule drafts, source linking, duplicate cleanup controls and keyboard map navigation. Run Electron suites sequentially. To retain screenshots outside the repository, set `ARCHIVO_SCREENSHOTS` to an output directory. See [AGENTS.md](AGENTS.md) for development boundaries and verification commands.

Mac packaging defaults to signing with an available Developer ID and skips notarization. `build-mac.sh --notarize` uses an existing Keychain profile (`NOTARY_PROFILE`, default `archivo-notarization`) without prompting for or storing new credentials. Windows packaging produces an NSIS installer and portable executable. Use the Windows CI runner or `build-win.bat` on a PC.

## License and attribution

Original archivo © 2026 Noar / just edit. Fork additions by Tanner Fugal. GNU GPL version 3 or later; see [LICENSE](LICENSE). Existing fonts retain their bundled licenses. Original source and release history remain available from the upstream repository.
