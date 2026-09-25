# v0 decisions

## Synchronization

Independent fields merge through field patches. Competing updates to the same field follow Convex's serialized commit order; the previous version is retained in history. A stale edit cannot revive a tombstone. Its attempted value is retained and can be explicitly restored. Subtree deletion tombstones the known descendants. A later child addition to a deleted folder is placed in Other. A concurrent move that would produce a cycle also moves the incoming node to Other.

Order is represented by numeric sibling positions, with ID tie-breaking. Destination projections compress positions for unsupported separators while retaining those separators in canonical state. This is a deterministic v0 ordering strategy, not a fractional-position CRDT; simultaneous complex native reorders require more compatibility testing before release.

Tombstones and operation history are not compacted in v0. This avoids resurrecting deleted records from old offline installations. A collection reaching its record or payload cap fails visibly with its queue preserved. There is no silent dropping of pending operations.

## Initialization and joining

After Google login through Convex Better Auth, a device durably stores an installation UUID and source snapshot before registration. Registration is idempotent by authenticated account and installation ID. The first registration atomically creates the account collection and device; an empty seed is a fully initialized empty collection. Later installations signed into the same account join the existing collection without reseeding it. UUIDs are identifiers, not authentication credentials.

A later browser saves its local bookmark snapshot for recovery, then installs the current cloud collection automatically. Every existing user bookmark under the mapped toolbar, other, and menu/mobile roots is removed through journaled native writes; cloud folders and bookmarks are created under those roots. Managed roots and browser machinery outside the portable roots are untouched. Existing cloud IDs are mapped to new native IDs on this browser. Its old local bookmarks are never uploaded or merged into the collection. If installation is interrupted, the journal and baseline resume the remaining writes without restarting with a blanket wipe. Pausing stops remote projection until resumed.

Connected browsers compare the cloud target with their persisted native baseline. They write only changed nodes and retain native IDs for unchanged bookmarks and folders. Startup reconciliation uploads queued local changes and pulls remote changes, subject to Pause. Large local batches still use review.

Large local batches (over 50 operations or over 20 removals) stop for review, retaining an earlier snapshot. This uses count thresholds, not anomaly detection. Recovery operations are new changes and propagate normally. Export is versioned JSON, not the browser's HTML bookmark format.

## Product boundaries

Default permissions are bookmarks, local storage, alarms, identity, and the configured Convex functions/auth origins. There are no page scripts, page access grants, toasts, notification permissions, or automatic popup windows.

The configured local Convex backend is ready to run. A cloud deployment must be created separately and its URL supplied in `.env.local`, followed by a rebuild. No production cloud resource was created by this implementation.

Public release still needs account deletion, request-abuse controls, retention limits and pruning, larger collection storage, signed packages, and the full browser/platform matrix. Server backups currently support investigation; only per-change restore and JSON export are exposed in the UI.
