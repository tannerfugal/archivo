# Archivo Fork 1.5.0 beta 2 — test guide

This fork adds background rescans, an offline storage map, and content-verified duplicate finding to archivo v1.4.0. Original archivo is © 2026 just edit; fork additions are GPL-3.0-or-later.

## Install

- **Apple Silicon Mac:** open the DMG and drag **Archivo Fork** to Applications. Alternatively extract the app ZIP. This local build uses Tanner Fugal’s Developer ID signature. It is **not notarized**: existing notarization credentials were unavailable. macOS may require Open Anyway in System Settings → Privacy & Security after the first attempt to open it.
- **Windows x64:** run the setup EXE, or use the portable EXE without installing. These test builds are **unsigned**, so Windows may show a publisher/SmartScreen prompt. Use only the files from this fork’s build artifacts.
- Upstream Archivo can remain installed. The fork uses a separate application identity and preferences directory. It does not change the default `.archivo` file association. Open catalogs from inside the fork.
- Downloadable CI artifacts are under https://github.com/tannerfugal/archivo/actions. They expire after 30 days. No public release is published by the workflow.

## First run

1. Open a **copy** of an existing `.archivo` catalog, or create a new one.
2. Use **Add disk** for mounted drives, or **Add folder / server** for a folder, a mounted Mac share, a mapped Windows drive, or an accessible network folder. Sign in through Finder or Explorer first.
3. Existing catalog entries need a local source link. Select the disk and use **Locate source…**, or link it from **Schedules**. Select the exact folder that represents the root of that catalog entry; linking the wrong folder would change what a future rescan indexes.
4. Save the catalog. Source links and schedules belong to this computer, so link sources separately on the PC.

## Schedules

- Open **Schedules**. The overview shows enabled schedules and linked sources. Expand **Drives to update** to choose sources, then set a daily time, selected weekdays, or an interval of 15 minutes–7 days.
- Large drive libraries use a compact summary and a scrollable list. Search labels, paths, categories or locations; narrow by category, physical location or link status. **Select shown** changes only eligible drives in the current filter; the mixed checkbox indicates a partial selection. Selected drives outside the filter stay selected and are counted explicitly. **Clear selection** clears the entire selection.
- Unlinked drives cannot be scheduled until linked with **Locate source…**. Link confirmation names the catalog disk. Draft selections, frequency, weekdays and time survive source linking and switching tools. New drives are added to a saved schedule through **Edit**; they are never enrolled silently.
- Saved schedules show their target count and frequency. Use **New schedule** for a separate rule, **Edit** to change its sources, and **Cancel edit** to discard a draft. Expand **Source links** to search or relink drives without opening a schedule form.
- Schedules start disabled. Check **Enable this schedule** and create it when ready. Use **Run now** for an immediate test.
- Close the window: Archivo Fork continues in the Mac menu bar or Windows system tray. Use its menu to reopen, pause schedules, run due scans, or quit. Explicit **Quit** stops scheduling. Launch at login is optional and off initially; it is available in the installed application.
- Multiple saved catalogs can have schedules. Unsaved edits defer the affected catalog until saved. Offline sources and scans with read errors retain their previous entries. Reconnect sources and use Run now to retry.
- After sleep or relaunch, one overdue run is performed per schedule. Daily and weekday times follow this computer’s current time zone. A nonexistent spring-forward time runs at the next valid local time; fall-back does not run a daily schedule twice.
- Completed updates save automatically. The five previous catalog versions live in `your-catalog.archivo.backups` beside the catalog. **Show catalog backups** opens that folder; open a backup as a catalog and use Save As to restore a separate copy.
- This version uses already connected OS shares. It does not store server passwords, mount disconnected shares, wake a sleeping computer, or run after quitting.

## Organization and offline search

- The shared sidebar has independent Category and Physical location trees. Categories start with Servers and Archive drives → Physically large / Physically small. Drives begin unassigned; the app does not infer physical size. Locations start empty.
- Use Edit beside either tree to add, rename, reparent or delete empty groups. Use Organize drives for bulk assignments, or assign a selected drive from its inspector. These labels never move physical files.
- Selecting a parent includes descendants. Category and location scopes intersect across Catalog, Storage Map and Duplicates. Active chips and Reset scope show how to clear them. Schedule targets remain independent and always show the complete catalog.
- Search filters combine with AND: filename, Exact filename (case-insensitive whole name including extension), modified or created date range, file type, drive, path contains, minimum/maximum bytes. One-character queries and filter-only searches work. Dates include the selected local calendar days. Byte limits apply to files with exact indexed sizes.
- Results are sortable and paginated (100 per page), with complete counts. Search uses offline catalog data in a worker. Changes invalidate results. Clearing a search or organization scope never removes catalog entries.
- Future scans record creation dates when supplied by the filesystem. Legacy missing creation dates show Unknown and do not match creation-date filters. Filesystem creation dates can change when copying between drives.
- Category/location paths appear in CSV and standalone HTML exports. Catalog validation, Save As, backups and scheduled saves preserve stable group IDs and assignments. Old upstream Archivo versions may discard these optional fields when saving: use a copy when testing upstream.

## Reveal diagnostics

Reveal has its own worker queue and validates the requested source and path freshly. Ordinary clicks avoid whole-system rediscovery; moved sources trigger discovery. Cleanup retains its separate full identity and content verification.

Buttons show Locating immediately, then Sent to Finder/Explorer or a readable error. Timings record queue wait (including worker startup), source resolution, path validation and shell dispatch in `reveal-timings.json` under the fork's local application data (`~/Library/Application Support/Archivo Fork` on Mac; `%APPDATA%/Archivo Fork` on Windows). Shell dispatch measures handing the request to the OS; it cannot measure when Explorer finishes drawing its window. Include timings when reporting a slow local disk or server Reveal.

## Storage Map

- Open **Storage Map**, select tiles to inspect them, and double-click folders to drill down. Use breadcrumbs to go back.
- Nested rectangles show folder and file contents immediately, with four levels by default. Change the detail depth, double-click to zoom, and use breadcrumbs to return. Single-child wrapper folders are passed through automatically. At most 4,000 blocks are drawn; smaller regions keep their full byte weight inside openable aggregates. Largest files and Largest folders cover every descendant in the current scope, with 50 rows per page.
- Reveal works when the disk is connected and locally linked. Show in catalog returns to its tree location.
- Map totals are the catalog’s indexed **logical bytes**, not allocated filesystem space. Scan date, drive capacity, and free space are shown separately. Approximate or missing imported sizes are labeled; rescan to obtain exact file sizes.
- The scanner retains upstream exclusions for dot-prefixed items, known OS/cache folders, and symbolic links. Nested mounted volumes should be cataloged as separate sources. A scheduled catalog excludes itself, its backups, and the application’s settings folder from its own scan.

## Duplicate folder areas

The default **Folder areas** view ranks top-level folders and loose root files after finding candidates or verifying contents. Each row shows matching file coverage, verified redundant bytes, possible bytes, and files with verified matches outside the area. Possible bytes are size matches, not proof of identical contents. Imported approximate/unknown sizes and zero-byte files remain excluded from candidate matching.

- Sort by verified space, possible space, matching files or coverage. Pages contain 20 areas. **Break down** explores the next folder level; **All drives** returns to the overview.
- **Other copy locations** lists paths outside the chosen area. **Review files** opens the original content groups for that area, with the other copies available for comparison and full report selections preserved.
- **Select verified copies** selects eligible local files together, only when an unselected verified copy remains outside the area. Previously selected copies affect which files can safely be added. The result reports any skipped copies. **Clear cleanup selection** clears all selected copies.
- Area estimates overlap: each of two duplicated folders can show the same reclaimable bytes. Do not add those rows. The report total counts redundant verified content once. A 100% file match is not a promise that permissions, timestamps, empty folders, excluded files, or other metadata match.
- Internal duplicates keep their parent area visible, but area selection requires an outside keeper. Break down or use **File matches** to choose individual copies instead. Folder selection never deletes a directory or its unique contents.

## Shared server access

Read [SHARED_CATALOGS.md](docs/SHARED_CATALOGS.md) for the Windows scheduler / multiple-client setup, permissions, update notices, conflict handling and lock recovery. Many readers can share a file. Updated writers coordinate through a sidecar lock; stale edits are refused rather than merged. Validate the real SMB server and client accounts before team deployment.

## Duplicates

1. Expand **Drives to compare**, using search, filters and **Select shown** for large libraries, then **Find possible copies** for an offline comparison. Exact matching sizes are candidates even when filenames differ; approximate imported sizes and empty files are excluded.
2. Connect and link the sources, then **Verify contents**. Sampled reads narrow candidates; full SHA-256 reads establish matching content. Large media files can take time. Cancel is available in the job bar.
3. Results identify content groups and distinguish Possible, Verified, Offline, Changed, Unreadable, Different, and Same file (hard links). Verified content groups are separate expandable cards, even when multiple content groups have the same byte size. Possible matches are labeled separately. Confirmed nonmatches and hard links appear under Show other results. Pages contain whole groups (20 per page); cleanup selections survive collapse and pagination. Export CSV records all results.
4. Nothing is selected automatically. Selected counts and bytes update immediately. Trash stays disabled for an empty selection or if no verified copy would remain in a group; network copies cannot be selected. To test cleanup, use disposable copies first. Select verified copies, leave at least one copy per content group, and choose **Move selected copies to Trash**. A confirmation is required; contents and source identities are checked again before moving anything.
5. Network files are inspection-only in this beta. If the OS cannot recycle a local file, it stays in place. There is no permanent-delete fallback. The surviving copy must still be connected and verified. File changes or disconnections stop cleanup.
6. Successful cleanup updates the open catalog and marks it edited; save to retain the updated file list. Restore recycled files through Finder’s Trash or Windows Recycle Bin, then rescan.

## Acceptance checks on your hardware

- Scan and rescan a USB disk, then disconnect it and confirm its offline catalog remains searchable.
- Reconnect with a changed Windows drive letter; confirm the correct linked volume is found. Test two drives with the same label and partitions on the same physical disk.
- Link a server folder, run a schedule, add a test file on the server, and run again. Disconnect the share and confirm the saved tree is preserved.
- Test a denied folder and unplug a test drive mid-scan: the previous scheduled entry must remain, with an activity entry explaining the incomplete run.
- Close the window and wait for a short interval schedule. Test sleep/wake and optional launch at login. Automated checks cover window hide/reopen behavior; tray/menu-bar accessibility and login behavior still need physical OS testing.
- Use small, disposable duplicate files, including differently named copies and same-size different contents. Confirm only matching contents become Verified, one copy is retained, and Trash restoration works.
- Report the platform, steps, expected/actual outcome, and the relevant Schedules activity text. Do not send credentials or private catalog contents.

## Development and reproducibility

```sh
npm ci
npm run check
npm run test:unit
npm test
npm run test:features
npm run test:polish
npm run test:advanced
npm run test:background
npm run build:mac:test   # Mac ARM64 DMG + ZIP
npm run build:win        # Windows x64 installer + portable
```

Node.js 22.12 or newer is required. UI integration uses Playwright’s Electron driver because a Browser plugin is not installed. The tests create disposable temporary catalogs and files, including an OS Trash test for one generated duplicate. No user drives are scanned by tests. Local Mac signing is discovered from Keychain; CI disables certificate discovery and produces unsigned packages. The product’s updater is disabled for these beta builds.

Validation distinguishes automated synthetic fixtures from physical USB/server testing. Passing CI does not establish performance on your full media archive, long-running reliability, network reconnection behavior, or distribution trust prompts.
