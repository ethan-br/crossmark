# v0 decisions

## Synchronization

Independent fields merge through field patches. Competing updates to the same field follow Convex's serialized commit order; the previous version is retained in history. A stale edit cannot revive a tombstone. Its attempted value is retained and can be explicitly restored. Subtree deletion tombstones the known descendants. A later child addition to a deleted folder is placed in Other. A concurrent move that would produce a cycle also moves the incoming node to Other.

Order is represented by numeric sibling positions, with ID tie-breaking. Destination projections compress positions for unsupported separators while retaining those separators in canonical state. This is a deterministic v0 ordering strategy, not a fractional-position CRDT; simultaneous complex native reorders require more compatibility testing before release.

Tombstones and operation history are not compacted in v0. This avoids resurrecting deleted records from old offline installations. A collection reaching its record or payload cap fails visibly with its queue preserved. There is no silent dropping of pending operations.

## Initialization and joining

After Google login through Convex Better Auth, a device durably stores an installation UUID and source snapshot before registration. Registration is idempotent by authenticated account and installation ID. The first registration atomically creates the account collection and device; an empty seed is a fully initialized empty collection. Later installations signed into the same account join the existing collection without reseeding it. UUIDs are identifiers, not authentication credentials.

A nonempty joining browser always stops at review, including after pause/resume or restart. Approval saves a server backup, then reconciles against the current cloud collection. Cloud records, titles, hierarchy, order and existing duplicates remain authoritative. The browser reuses matching native entries, imports new content, and removes surplus local copies through journaled native writes. The original local snapshot remains available in the recovery export.

The same matching policy applies to every browser:

- Bookmarks match by exact URL string anywhere in the collection, regardless of title or folder. No normalization is performed: different schemes, case, trailing slashes, queries and fragments are distinct URLs. A different title alone is not a new bookmark.
- Folders match by exact, case-sensitive title under the matched parent, starting at the logical toolbar/other/menu root. Different paths are distinct folders; new folders, including empty folders, are imported. Children of matched folders use their cloud parent identity. Mobile content is outside portable sync scope.
- Existing cloud duplicates are preserved. Local copies first reuse unused matching cloud entries, preferring the same parent and title, then the same parent, then canonical order. Surplus local copies collapse into those matches. Repeated new URLs or folder paths in the joining tree import once; the first in parent-first order supplies their content.
- Separators match by kind, matched parent and sibling position. Chromium continues to omit separators from its native projection.
- New nodes append after existing cloud siblings. Tombstones do not match; a locally present URL whose old record was deleted imports with a new identity. Ordinary edits after joining continue to use identities and can intentionally create duplicate URLs.

The join transaction saves its result on the device. Retries, background restarts and overlapping approvals use the current collection or the saved result without repeating imports. Deploy the updated Convex schema and join mutation before distributing the updated extension. Already-connected browsers continue to consume ordinary snapshots; this change does not remove duplicates already present in the cloud.

Large local batches (over 50 operations or over 20 removals) stop for review, retaining an earlier snapshot. This uses count thresholds, not anomaly detection. Recovery operations are new changes and propagate normally. Export is versioned JSON, not the browser's HTML bookmark format.

## Product boundaries

Default permissions are bookmarks, local storage, alarms, identity, and the configured Convex functions/auth origins. There are no page scripts, page access grants, toasts, notification permissions, or automatic popup windows.

The configured local Convex backend is ready to run. A cloud deployment must be created separately and its URL supplied in `.env.local`, followed by a rebuild. No production cloud resource was created by this implementation.

Public release still needs account deletion, request-abuse controls, retention limits and pruning, larger collection storage, signed packages, and the full browser/platform matrix. Server backups currently support investigation; only per-change restore and JSON export are exposed in the UI.
