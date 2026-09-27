# Validation

Product testing has two layers:

1. **Isolated Vitest suite** (`npm test`) — fast unit/integration tests with WXT's Vitest plugin and `@webext-core/fake-browser`. No developer browser profile, live OAuth, local Convex backend, or interactive browser is required.
2. **Browser smoke tests** (`npm run test:browser`, `npm run test:firefox`, `npm run test:debug`) — install the real WXT-built extensions in disposable profiles and exercise native bookmark APIs. Keep these separate from the Vitest suite; they are slower and need browser binaries.

WXT's development server supports extension reloads; there is no standalone simulated web page or preview tunnel.

## Isolated Vitest suite

`npm test` runs Vitest with `vitest.config.ts`, which loads [`WxtVitest`](https://wxt.dev/guide/essentials/unit-testing.html). Shared setup in `tests/setup/wxt.ts`:

- Points `webextension-polyfill` at the in-memory fake browser (storage, runtime messaging, tabs, alarms, action).
- Installs in-memory bookmark trees (Chromium or Firefox-shaped roots) where fake-browser leaves bookmark APIs unimplemented.
- Stubs unused `identity` APIs so tests never touch live OAuth credentials.
- Resets fake-browser state between tests.

The suite covers:

- Better Auth session validation, expired/unauthenticated sessions, account isolation on reads/writes/revocation, idempotent initialization and same-account joining.
- Email/password sign-in and sign-up requests, rejected credentials, untrusted origins, unreachable backends, private session storage without the password, JWT use and expired session cleanup. Client transport tests use mocks against fake storage/runtime. Separate tests exercise the real Better Auth HTTP routes for sign-up, sign-in, Convex token issuance, wrong/short passwords, duplicate accounts, origin checks and the removed Google routes.
- Independent field merges, tombstones, cycles, native convergence, joining replacement, pause/resume, missed events, crash journals, root disappearance, mass deletion, upload retries, interrupted initialization and edits during projection.
- Extension backend origin validation, loopback defaults and network permission/CSP configuration for both browsers.
- Background ↔ popup messaging boundaries: trusted sender checks, command allowlisting, connect/revoke validation and engine error surfacing (without a live extension page).
- Firefox vs Chromium adapter behavior (menu roots, separators, portable-root selection) in Vitest. Full native menu/separator smoke remains browser-level.

`npm run check` performs TypeScript checking, the isolated test suite and both extension builds.

## Browser smoke tests

`npm run test:browser` and `npm run test:firefox` install the actual builds in disposable profiles. Each checks startup, native reads, the replacement warning in the email/password sign-in UI, an error for a failed sign-in (unreachable backend or unknown account), preservation of bookmarks while signed out, credential-free export and popup reopening. Firefox additionally reads its native menu and separators. No personal profiles are opened. Firefox's system-context permission is used only to open the installed extension's own popup page. The Firefox package command creates an XPI with `manifest.json` at its archive root; an archive containing a top-level `firefox/` directory is invalid.

Screenshots and results are written to `output/verification/chromium-*` and `firefox-*`. Use the manual checklist for signed-in behavior.

`npm run test:debug` tests the built Chromium background diagnostics without a backend. `npm run package:firefox` and `npm run lint:firefox` validate WXT's unsigned XPI and Mozilla manifest compatibility; live signing is a separate step requiring AMO credentials. Pull-request CI runs the isolated suite and both headless smokes; see [CI and releases](ci.md). See [WXT migration](wxt-migration.md) for production/dev paths and environment precedence.

## Manual login and sync checklist

Complete [login setup](auth-setup.md), build and load both extensions in disposable profiles with test bookmarks.

1. Create an account in Chromium. Confirm account email, browser name and seeded bookmark counts. Close and reopen the popup during and after login; the background should complete the operation.
2. Sign in with the same account in Firefox. Include overlapping URLs with different titles/folders, repeated local URLs, and local-only URLs. Confirm the sign-in warning explains replacement, then Firefox replaces these with the cloud tree automatically, preserves managed roots, and does not add local-only URLs to the collection. Export `joinRecovery`, sign out/in to the same account, and verify both stable native IDs and the original `joinRecovery` tree. Repeat in both directions for Chrome, Helium and Firefox.
3. Add, rename, move, reorder and delete native bookmarks in both browsers. Check convergence, exact URLs, Firefox menu mapping and separator retention. Repeat sync without edits and check native IDs remain stable with no create/remove calls. Restart a connected browser with pending work and confirm it uploads and pulls automatically.
4. Pause one browser, make local changes, and resume. Check pending changes survive popup/background restarts and upload once. Test network loss and reconnection.
   - **Pause this browser.** In Chromium, choose Pause on the overview. Its Browsers row reads "Paused" and has no actions of its own. Within 30 seconds Firefox's Browsers tab shows Chromium as "Paused". Resume it; both tabs return to "Last synced …".
   - **Pause another browser.** From Chromium, choose Pause on the Firefox row. Chromium shows Firefox as "Paused" immediately. With Firefox open, its overview switches to "Sync paused" within 30 seconds; edits made in either browser do not reach Firefox, and Firefox's edits stay pending. Resume Firefox from Chromium; pending edits upload once and both browsers converge.
   - **Resume after a remote pause.** Pause Firefox from Chromium. In Firefox, "Sync now" is disabled; choose Resume instead. Chromium shows Firefox as "Last synced …" after its next sync.
   - **Disconnect with unsynced edits.** In Chromium, add a bookmark and immediately disconnect Firefox from Browsers. The new bookmark uploads as part of that action rather than waiting for the next background sync.
   - **Offline pause.** Disable the network, pause a browser, re-enable the network. The other browser shows it as "Paused" after the next sync.
   - The Browsers list shows only each browser's name (the current browser has a highlighted icon) and either "Paused", a sync problem (this browser only), or "Last synced …". No browser type, change counts, or "Applied" text appears.
5. Delete a folder and confirm Activity shows only `<folder> removed` with a relative time, with no restore action, source browser or path. Export from Settings and check it contains bookmark/recovery data without sessions or credentials.
6. Create a different test account in a third profile; confirm a separate collection. Reauthentication on an existing installation must reject switching accounts until sign-out.
7. Disconnect another browser from Browsers; the confirm dialog names it and says its bookmarks stay in that browser. It disappears from the list. Try syncing it; native bookmarks should remain intact. Sign out and sign in again on it to reconnect to the same account's collection.
   - Sign out from Settings. The confirm dialog says this browser stops syncing, leaves the connected browsers and keeps its bookmarks. The popup returns to sign-in, native bookmarks remain, and the other browser no longer lists it. With pending changes, Sign out refuses until they sync.
8. End/expire a Better Auth session using the development dashboard. Confirm the extension asks for the password again and retains queued edits. Reauthenticate with the same account and sync them.
9. Reinstall in a disposable profile and sign in again. Confirm the server collection is not reseeded and local portable-root bookmarks are replaced without approval.
10. In Chromium with both local and account bookmark trees, confirm a new installation selects the account toolbar and Other pair. Confirm a connected installation keeps its chosen pair when another appears, then change the selected native root IDs and verify toolbar, other and menu sync continues without reconnecting.

## Current verification

For the WXT migration, the isolated suite, TypeScript and both production builds passed, including from a fresh `npm ci`. The built Chromium and installed Firefox 156 extensions each passed seven headless smoke checks on macOS against an unconfigured-backend HTTP fixture. Chromium debug checks and the Firefox identity/denied-callback fixture passed. Firefox lint reports zero errors and the same four warnings as the old build (minimum-version data collection declarations and bundled React `innerHTML` use).

Email/password login replaced Google login after this migration. Successful live login, session renewal, authenticated native browser-to-browser sync and AMO signing were **not exercised by the migration checks**. Follow the manual checklist before release.

Minimum build targets (Chromium 120 / Firefox 128), Helium, other derivatives, Windows and Linux remain unverified. Before public release, test store installation, account-root changes, browser-vendor sync interactions, force-killed workers, long offline periods, large collections, retention/account deletion and signing.
