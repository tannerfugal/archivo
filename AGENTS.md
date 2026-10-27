# Working on Archivo Fork

This is a plain JavaScript Electron application based on upstream Archivo v1.4.0. Keep the fork identity, attribution, offline `.archivo` compatibility, and existing dark interface.

## Setup and verification

- Use Node.js 22.12 or newer (`nvm use` selects Node 22), then `npm ci`.
- `npm run check` checks dependencies, syntax, build assets, and package version consistency.
- `npm start` launches development mode. It uses the fork's real local preferences. Integration tests instead create isolated temporary app data and disposable catalogs.
- Before handing off changes, run `npm run check`, `npm run test:unit`, `npm test`, `npm run test:features`, `npm run test:polish`, `npm run test:advanced`, and `npm run test:background`. Run Electron suites sequentially.
- `test:polish` exercises 30 drives, filtered bulk selection, schedule drafts, duplicate selection guards and 1280/1100px layouts. Set `ARCHIVO_SCREENSHOTS` to a directory outside the repository for screenshots.
- Build commands explicitly disable publishing. Do not claim signing, notarization, Windows runtime, or physical drive acceptance from source tests alone.

## Implementation boundaries

- `main.js` owns IPC and OS integration; `preload.js` exposes the sandbox API. `service.js` coordinates jobs, local source bindings and schedules. `worker.js`/`jobs.js` handle expensive I/O outside the UI.
- Keep source identity authoritative. Drive names never authorize scanning, Reveal, hashing or cleanup. Keep bindings/schedules in local application data, never inside imported catalogs.
- Preserve previous trees on offline/incomplete scheduled scans; successful saves must retain conflict checks and backups.
- Duplicate cleanup must recheck full contents and identity, retain a verified survivor, use OS Trash only, and reject network removal. UI checks supplement the main-process checks.
- Reuse `createDrivePicker` for drive selection. Bulk controls apply to filtered, eligible rows and retain hidden selections; adding a drive does not silently enroll it in a saved schedule.
- Use the shared CSS tokens and native controls. Validate actual rendered interactions after UI changes. The existing Playwright Electron driver can exercise the sandboxed app directly.
- Preserve inherited work. Use disposable fixtures for tests; do not scan user drives or change real schedules during automated verification.

- Shared catalog saves and cleanup must use the cooperative catalog lock, version checks and atomic replacement. Never auto-steal stale locks. Read [docs/SHARED_CATALOGS.md](docs/SHARED_CATALOGS.md) before changing concurrency behavior.
- Folder duplicate summaries are navigation and impact estimates. Keep possible matches separate from verified content, do not add overlapping area savings, and retain a verified unselected copy when bulk-selecting.
