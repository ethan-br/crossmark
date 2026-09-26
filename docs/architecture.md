# Architecture

The popup issues narrowly validated commands to the background. Background code owns a single serialized engine, the private Google-backed session, native mappings, the durable operation queue, and the apply journal. UI status reflects the engine's persisted state. No content scripts are installed.

WXT discovers the background and popup in `apps/extension/entrypoints` and generates both Manifest V3 extensions. Background initialization runs inside `defineBackground`, with listeners registered synchronously. Browser-specific permissions and identity settings live in `apps/extension/manifest.ts`; the existing browser API polyfill, auth session storage and engine remain shared. See [the WXT migration guide](wxt-migration.md) for build and development details.

`storage.local` holds one versioned state record per installation. A serialized operation writes the whole state before network calls or native mutation. Missed bookmark events are recovered by comparing the native tree with the persisted baseline on startup and alarms. The short debounce is an optimization; a durable alarm is also scheduled. Import notifications postpone short-timer processing until import ends. Native APIs cannot transact with extension storage, so writes are journaled before execution.

Convex mutations atomically authenticate a device, validate operations, update the collection, record history, and advance the device sequence. A repeated operation ID for the same device is acknowledged without applying twice. Unexpected actor sequences fail, preventing an out-of-order batch from skipping work. Convex Better Auth validates the session and derives the account owner. Each request checks the installation belongs to that owner and is not revoked. The background stores its Better Auth session separately from engine state and obtains short-lived Convex JWTs; popup state contains account identity but no credentials.

Each collection is currently one bounded snapshot document plus devices, operation history and backup tables. This deliberately favors a reviewable implementation over large-scale incremental storage. A snapshot revision is the delivery cursor. A device checkpoint advances only after native projection succeeds. The browser list distinguishes server revision from the last applied device cursor.

Google is the only configured provider. The browser identity API launches OAuth, Better Auth handles the Google callback, and its cross-domain plugin transfers the resulting session back to the extension. The plugin’s internal short-lived handoff is never displayed as an enrollment code and cannot create a session without provider login. Callback origin, path and a per-attempt nonce are checked before exchange. Setup is in [Google OAuth setup](google-oauth-setup.md).

## Native application and recovery

Canonical IDs are independent of native IDs and URLs. Intentional duplicate URLs survive seeding and ordinary edits. Joining uses the [content matching policy](v0-decisions.md#initialization-and-joining) to adopt cloud identities and import genuinely new content in one Convex transaction against the current collection. The device stores the join result, and the extension stores its input before sending it, so a lost response reuses the same identity mapping. Native mappings and the baseline are then saved together before projection; surplus local copies remain tracked until journaled deletion completes. Existing cloud duplicates remain intact.

The initial snapshot is stored before registration, allowing an interrupted first registration to retry with the same installation ID, account and baseline. Subsequent native edits are then diffed rather than mistaken for part of the uploaded seed. Joining similarly captures changes made after its persisted input before applying the canonical state.

Every native mutation has a persisted journal. A create journal stores the intended node and the parent's pre-write child IDs. After restart, a single matching newly appearing child is adopted; ambiguous candidates stop synchronization. Update, move, and delete are replayed idempotently. Expected index shifts update the baseline, so native reorder echoes do not generate redundant remote writes.

Before each native write the engine rereads the tree. Unexpected differences are captured and uploaded before continuing remote projection. Events are never globally suppressed. Removing a folder uses nonrecursive `remove`; a new local child prevents destructive removal. The native API still has a read/write race window: a user can change the exact same field between the check and the write. This v0 does not claim atomicity against simultaneous native user edits.

## Browser roots

Chromium maps `bookmarks-bar` and `other` by `folderType`. Where local and account trees coexist on a new installation, it selects the account pair. A connected installation retains its previously selected pair, whether local or account. Root IDs can change without reconnecting; switching a connected installation to the other tree pauses sync. Before connection, the selection follows the live browser roots. Firefox maps its stable toolbar, unfiled, and menu IDs. Unsupported top-level roots, managed roots, and browser-specific collections are ignored.

The Chromium folder named “Bookmarks Menu” directly under the selected Other root maps to the canonical menu root. An existing folder is adopted; one is created with a journal only when menu content needs it. A missing mapped menu folder pauses sync while connected. Mobile is outside the portable sync scope: mobile roots and their descendants are neither captured, matched during joining, nor projected. Legacy cloud mobile content stays in the snapshot without blocking the three portable roots. Firefox separators remain in the canonical collection and are omitted from Chromium's projection.

## Lifecycle

All listeners register synchronously. An alarm polls every 30 seconds; the browser may defer it during sleep. Failures persist a bounded exponential retry time with jitter. Explicit retry bypasses the wait. Incoming changes are pulled durably; no permanent worker or WebSocket lifetime is assumed.

Reference APIs: [Chrome bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks), [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [Firefox background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background), and [Convex local development](https://docs.convex.dev/cli/local-deployments).
