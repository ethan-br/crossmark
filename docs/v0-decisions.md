# v0 decisions

## Synchronization

Independent fields merge through field patches. Competing updates to the same field follow Convex's serialized commit order; the previous version is retained in history. A stale edit cannot revive a tombstone. Its attempted value is retained in server history for investigation. Subtree deletion tombstones the known descendants. A later child addition to a deleted folder is placed in Other. A concurrent move that would produce a cycle also moves the incoming node to Other.

Order is represented by numeric sibling positions, with ID tie-breaking. Destination projections compress positions for unsupported separators while retaining those separators in canonical state. This is a deterministic v0 ordering strategy, not a fractional-position CRDT; simultaneous complex native reorders require more compatibility testing before release.

Tombstones and operation history are not compacted in v0. This avoids resurrecting deleted records from old offline installations. A collection reaching its record or payload cap fails visibly with its queue preserved. There is no silent dropping of pending operations.

## Initialization and joining

After email/password login through Convex Better Auth, a device durably stores an installation UUID and source snapshot before registration. Registration is idempotent by authenticated account and installation ID. The first registration atomically creates the account collection and device; an empty seed is a fully initialized empty collection. Later installations signed into the same account join the existing collection without reseeding it. UUIDs are identifiers, not authentication credentials.

A browser connecting to an existing account must explicitly select local replacement with the account collection or account replacement with its current local tree. No merging is offered. Local replacement preserves the first pre-Crossmark tree in `joinRecovery` (including an empty tree), which survives reconnects, sign-out and account changes. Account replacement is atomic with registration and a server backup; it assigns fresh incoming identities and retains the old collection as tombstones so stale edits cannot revive replaced nodes. Both modes preserve supported titles, hierarchy, order and intentional duplicates. Managed, mobile and unsupported roots are not touched.

Disconnect and restore revokes this browser’s connection, persists a detached restore job and projects the original snapshot using native-write journaling. It never queues the restored tree for upload. An interrupted restore resumes on startup and blocks reconnect until complete. Restored browsers remain disconnected; reconnecting requires the local-versus-account choice again. Existing JSON exports remain available. The popup no longer exposes the earlier additive recovery flow.

Replacement uses child-first, journaled native deletions followed by cloud projection. The journal resumes an interrupted native write without deleting and recreating a cloud node already installed. A persisted wipe phase separates removal of the old local tree from installation. Explicit Pause defers replacement. Once connected, sync compares the cloud tree with the native baseline and writes only changed nodes; unchanged native IDs remain stable. Startup processes pending uploads and pulls remote changes unless paused.

Large local batches (over 50 operations or over 20 removals) stop for review, retaining an earlier snapshot. This uses count thresholds, not anomaly detection. Ordinary individual bookmark edits remain in sync; restoring the pre-Crossmark tree explicitly leaves sync. Export is versioned JSON, not the browser's HTML bookmark format.

## Product boundaries

Default permissions are bookmarks, local storage, alarms, and the configured Convex functions/auth origins. There are no page scripts, page access grants, toasts, notification permissions, or automatic popup windows.

The configured local Convex backend is ready to run. A cloud deployment must be created separately and its URL supplied in `.env.local`, followed by a rebuild. No production cloud resource was created by this implementation.

Public release still needs account deletion, request-abuse controls, larger collection storage, signed packages, and the full browser/platform matrix. Server backups (seven days) and operation history (30 days) support investigation; permanent compact deletion fences protect offline clients. See [capacity and retention](capacity-retention.md); JSON export and local pre-Crossmark restoration are exposed in the UI.

Activity is a short, non-diagnostic feed limited to four lines: `<title> added`, `<title> removed`, `<title> moved` and `<browser> synced`, each with a relative timestamp. Only structural changes to bookmarks and folders appear: creates, deletes of live items and moves to a different folder. Title/URL edits, reorders within a folder, stale edits to deleted items and separators are omitted. Rows do not carry the node kind, so added bookmarks and folders share one icon. Each browser contributes one `synced` line, updated when it applies revisions produced by another browser (including the initial collection seed when joining). Uploading its own changes and idle polling do not refresh it. Browsers connected before `lastSync` existed show no `synced` line until they next receive a remote change.

There is no per-change restore and no conflict indicator. When a concurrent or stale edit loses, the other browser's value wins without notice; the losing value remains only in server operation history, which is not exposed to clients or included in the export.

Deploy the Convex schema and `snapshot`/`checkpoint` changes before distributing the extension. The extension hides activity kinds from older backends, so the feed is empty until the server is updated.
