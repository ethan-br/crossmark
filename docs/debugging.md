# Extension debug mode

Debug mode is off by default. Enable it without rebuilding, including before signing in:

1. Open the extension's background console. In Chromium, open `chrome://extensions`, enable Developer mode, and inspect Crossmark's service worker. In Firefox, open `about:debugging#/runtime/this-firefox`, find Crossmark, and choose Inspect, then Console.
2. Run `await crossmarkDebug.setEnabled(true)`.
3. Reproduce the problem. Show Debug/Verbose messages in the console and filter for `[Crossmark debug]`.
4. Run `crossmarkDebug.export()` to get a JSON string containing the latest 500 events. Copy the returned string into a `.json` file for a bug report. Chromium's console also supports `copy(crossmarkDebug.export())`.
5. Run `await crossmarkDebug.setEnabled(false)` when finished. Run `crossmarkDebug.clear()` to erase the retained buffer, and use the console's Clear button to remove already printed messages.

The helpers exist only in the background console, not in a webpage or popup console. The underlying setting is the boolean `crossmarkDebugEnabled` in extension `storage.local`. Only `true` enables logging; removing it disables logging. Storage changes take effect live. The setting persists across background restarts and sign-out. Toggle it separately in each browser installation.

Events include a timestamp, browser family, background runtime, operation and outcome. Timed operations include a session-local numeric request ID and elapsed milliseconds; sync decisions include operation counts, retry attempts and delays. Authentication, connect/disconnect/revoke commands, bookmark reads/writes/recovery, reconciliation, retries and failures are covered. A successful command means the command returned; consult `sync.exchange` outcomes to see whether synchronization succeeded, paused, needs review or scheduled a retry. State polling itself is not logged, though bookmark reads it triggers are.

Logs are kept in memory, never uploaded automatically or persisted to disk by Crossmark. The buffer is lost when the background worker/page stops or the extension reloads; export before closing the debugging surface. Opening DevTools can keep a service worker alive and change suspension behavior. Disabling stops new logs but leaves the existing buffer available to export or clear. Clearing also prevents in-flight traced operations from repopulating the cleared buffer on completion. The browser console and any exported files are separate copies; clear/delete those separately.

Only fixed event names and allowlisted finite numeric fields enter the logger. Passwords, session tokens, cookies, account details, bookmark URLs/titles, device names, native/entity IDs, request/response bodies, and raw error messages/stacks are omitted. Failures are recorded by operation and outcome, without their potentially sensitive text. Review any exported report before sharing: timestamps, browser family, counts and timings still reveal activity patterns. This mode does not sanitize unrelated messages produced by the browser or third-party libraries; share the JSON export instead of a full console dump.

For a repeatable packaged Chromium check without a backend, run `npm run build` followed by `node scripts/debug-smoke.mjs` (requires Playwright Chromium installed). It verifies default-off behavior, opt-in, bookmark events, content omission, the live storage toggle, export and clearing in a disposable profile.
