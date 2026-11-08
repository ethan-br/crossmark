# Connecting a browser and restoring its original bookmarks

When connecting to an existing account, choose one collection explicitly:

- **Use synced bookmarks:** replace the bookmarks in this browser with the account collection. The original local tree is saved before registration or replacement.
- **Use this browser’s bookmarks:** replace the account collection with this browser’s current tree. All connected browsers receive this replacement. Confirm the account-wide change before continuing. The previous account collection is saved in a server recovery snapshot; server snapshots are not currently browsable in the popup.

There is no merge option. A new account starts with its first browser’s bookmarks. Once connected, individual additions, edits, moves, and deletions continue syncing normally, with existing large-change review protection.

## Disconnect and restore

In Settings → Pre-Crossmark bookmarks, choose **Disconnect and restore** and confirm. Crossmark revokes this browser’s connection before replacing its current bookmarks with the original saved tree. Other browsers and the account collection are unchanged. Unsynced local changes are not uploaded; the tree immediately before restoration is retained as the local safety snapshot in the JSON export.

After restoration, the browser stays outside sync, including after restart and later native bookmark edits. To reconnect, sign in and make the local-versus-account choice again. The original snapshot is preserved across reconnects, sign-out and account changes. If signed out, the welcome screen also offers restoration when a snapshot exists. An empty original snapshot can be restored.

Revocation requires a working connection and valid sign-in. If revocation fails, bookmarks remain unchanged. Once revocation succeeds, the restore job is saved before native writes and uses the existing native-write journal. If interrupted, startup resumes it; the popup also offers Retry restoration. Keep the browser’s bookmark manager idle until restoration finishes.

## Exports and practical limits

Settings → Export bookmarks downloads version 1 JSON containing the cached collection (`nodes`), last safety snapshot (`localRecovery`), original tree (`joinRecovery`), and pending operations. These files include private bookmark titles and URLs. Keep exports outside extension storage before removing the extension or clearing browser data, which erases local recovery snapshots. Restoring pre-Crossmark bookmarks uses the locally saved snapshot; the popup does not offer JSON import or additive recovery.

Only supported portable roots are replaced. Managed, mobile and unsupported roots remain untouched. Chromium cannot represent separators. Account replacement keeps old identities as tombstones to protect against delayed edits. Both the incoming live tree and retained tombstones must fit the normal 2,000-record / 600 KB collection limits; an over-capacity replacement is rejected atomically. Concurrent edits on other browsers remain ordinary sync changes, so replacement does not freeze all devices globally. Deploy the updated Convex `connect` mutation before distributing an extension that offers account replacement.
