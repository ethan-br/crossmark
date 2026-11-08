# Connecting a browser and restoring its original bookmarks

When connecting to an existing account, choose which bookmarks to keep. The two sets will not be combined.

- **Use synced bookmarks:** replace this browser’s bookmarks with the account’s synced bookmarks.
- **Use this browser’s bookmarks:** replace the account’s synced bookmarks with this browser’s current bookmarks. This also replaces bookmarks on all other connected browsers. Confirm this change before continuing.

Crossmark saves this browser’s original bookmarks before it first connects. That saved copy survives reconnects, sign-out and account changes; it is not replaced each time you connect. Before replacing the account’s bookmarks, Crossmark also saves a copy on the server. The popup does not offer a way to browse or restore server copies.

If connecting fails, retry with the same bookmarks selected, or choose **Cancel** before selecting different bookmarks. Cancel needs a connection to the Crossmark server to check whether connecting finished and disconnect this browser if needed. It does not undo an account replacement that already happened.

A new account starts with its first browser’s bookmarks. Once connected, individual additions, edits, moves and deletions sync normally. Large changes may require approval before they update other browsers.

## Disconnect and restore

In Settings → Pre-Crossmark bookmarks, choose **Disconnect and restore** and confirm. Crossmark removes this browser from sync before replacing its current bookmarks with its saved original bookmarks. The account’s synced bookmarks and other browsers stay as they are. Changes waiting to sync are not sent. Crossmark keeps a safety copy of this browser’s bookmarks from immediately before the restore in the JSON export.

After restoring, this browser stays disconnected, even after restarting or editing bookmarks. To reconnect, sign in and choose which bookmarks to keep again. If signed out, the welcome screen also offers a restore when original bookmarks are saved. If this browser originally had no bookmarks, restoring removes its current bookmarks.

Disconnecting needs a working server connection and valid sign-in. If it fails, the restore does not start. If restoring is interrupted after disconnection, Crossmark tries to continue at startup; the popup also offers **Retry restore**. Keep the browser’s bookmark manager idle until restoring finishes.

## Exports and practical limits

Settings → **Export bookmarks** downloads a JSON file, not a file you can import through the browser’s bookmark manager. It includes the last known synced bookmarks, a safety copy, the original bookmarks and changes waiting to sync. The popup does not offer an import feature.

Exports contain private bookmark titles and URLs. Save them outside the extension before removing Crossmark or clearing its browser data: those actions erase the saved original bookmarks and safety copy. Restoring original bookmarks needs the copy saved in this browser.

Only supported bookmark folders are replaced. Bookmarks managed by an organization, mobile bookmarks and unsupported folders stay as they are. Chromium browsers cannot display bookmark separators.

Account limits include saved records of deleted bookmarks: 2,000 total records and 600 KB. A replacement can exceed these limits even when fewer than 2,000 bookmarks are visible. Changes made on other connected browsers can still sync during replacement.

For developers: exports use version 1, with synced bookmarks in `nodes`, the last safety copy in `localRecovery`, original bookmarks in `joinRecovery` and pending operations. Deploy the updated Convex `connect` mutation before distributing an extension that offers account replacement.
