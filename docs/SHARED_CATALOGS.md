# Shared catalogs on a server

The catalog is a compressed file containing an offline index, not a database server. Each machine searches its own loaded snapshot. Many people can read it concurrently without holding a write lock or needing the source drives connected.

## Suggested setup

1. Put one `.archivo` catalog in an OS-managed server share, for example `\\ArchiveServer\Catalogs\Studio.archivo`. Mac users open the same file through the mounted share, such as `/Volumes/Catalogs/Studio.archivo`.
2. Run scheduled catalog updates on the designated Windows PC. Link its sources on that PC and enable its schedules. Source links and schedules are machine-local; opening the shared catalog does not import or enable them on other computers.
3. Give search-only users read access. People who edit need permission to create, rename and remove files and directories in the catalog folder, including its `.lock` directory and `.backups` directory. Configure consistent inherited Windows/share permissions; test them with the actual accounts.
4. Install the updated fork on every machine that saves. Old builds, upstream Archivo and other editors do not participate in its lock protocol. Reading with an older build is different from saving with it.
5. Open the shared file directly rather than separate synced copies. Avoid cloud-sync folders or replicas for simultaneous writes: those do not provide a single shared lock. Use one path to one server file.

The Windows PC is the usual scheduler, not the only editor. Other machines can search, organize, analyze, export, link local sources, verify accessible files, and save edits when their snapshot is current and their account allows writes. Finder/Explorer Reveal requires that computer's own source links; offline search does not.

## Updates and edits

- The app checks file metadata about every 15 seconds and compares contents when metadata changes. A full comparison at least every five minutes catches changes whose metadata appears unchanged. **Check catalog updates** requests a full comparison immediately. Slow or unavailable shares can delay checks.
- A newer version shows a notice. **Reload latest** loads it; the app does not replace unsaved work automatically. Reloading resets the current tool/search/selection as opening the catalog does.
- If you have unsaved edits, the reload dialog offers a separate copy or explicit discard. **Save a copy** requires an unused destination and switches the document to that copy. Reopen the server catalog to return to the shared version.
- A save checks the exact version you opened while holding a shared lock through backup creation and replacement. If another user or the scheduler saved first, your save is refused and your edits remain open. Save a copy, reload, then reapply the desired edits. Changes are not automatically merged.
- Save the changed catalog after cleanup so other clients can reload its updated file list.
- Cleanup also holds the shared catalog lock, checks that its report still belongs to the current catalog version, and freshly verifies contents and surviving copies. Bulk folder selection uses the existing file-level Trash checks; it never recursively deletes a folder or unique files. Network removal remains disabled.
- If the share disconnects, the loaded snapshot remains searchable. Reconnect and check/reload. A failed save does not deliberately replace the catalog with an empty or partial scan.

## Locks, backups and limitations

The lock is a short-lived directory beside the catalog: `Studio.archivo.lock`. It identifies the host and time of the writer. Readers ignore it. Writers reject contention instead of waiting indefinitely.

A crash or killed write worker can leave a lock behind. The app never steals it based on an old timestamp, another machine's process ID or a timeout. An administrator must first stop all saves/cleanup/schedulers for that catalog, verify no writer is active, and then remove that specific leftover `.lock` directory. Restart normal use afterward. Never remove an active lock.

Catalog saves keep five prior versions beside the file. Those are catalog history, not footage backups or protection against losing the server. Include the catalog and its backups in the server's independent backup system. The scheduled update feature indexes files; it does not back up media.

This supports many readers and coordinated, conflict-checked writes from updated clients. It is not live collaborative editing or a transactional server API. A continuously shared edit history, automatic merging, authentication and centrally coordinated jobs would be a separate server-backed design.

Local tests exercise competing processes, readers during replacement, conflicts, stale locks, permissions and disconnected snapshots. Windows CI also exercises local/UNC access to a disposable SMB share when permitted. These do not certify your NAS, actual Windows server, SMB reconnect behavior, ACLs or storage durability. Before team rollout, test two real machines saving stale snapshots, a scheduler update while someone has edits, disconnect/reconnect, permissions, and recovery from a deliberately stopped disposable writer.

Implementation uses metadata polling because Node documents reliability limits for network file watchers: [Node filesystem caveats](https://nodejs.org/api/fs.html#caveats). It uses directory creation for cooperative locking rather than relying on an exclusive file-open flag; Node also documents that flag's limitations on network filesystems: [filesystem flags](https://nodejs.org/api/fs.html#file-system-flags).
