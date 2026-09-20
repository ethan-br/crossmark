# Validation

Product testing uses built extensions: automated headless browser runs or manual installation. There is no simulated web page, preview server or tunnel.

## Automated checks

`npm run check` performs TypeScript checking, the isolated test suite and both extension builds. The tests cover:

- Better Auth session validation, expired/unauthenticated sessions, Google account isolation on reads/writes/revocation, idempotent initialization and same-account joining.
- OAuth callback origin/path/nonce checks, rejecting non-Google authorization URLs, private session transfer, JWT use, missing configuration and expired session cleanup. Client transport tests use mocks. Separate tests exercise the real Better Auth HTTP routes for Google authorization URL generation, identity scopes, redirect validation, and disabled password login; they do not complete live Google OAuth.
- Independent field merges, tombstones, cycles, native convergence, explicit merge approval, pause/resume, missed events, crash journals, root disappearance, mass deletion, upload retries, interrupted initialization and edits during projection.

With the local backend running and Google credentials absent, `npm run test:browser` and `npm run test:firefox` install the actual builds in disposable profiles. Each checks startup, native reads, Google-only sign-in UI, a useful missing-configuration error, preservation of bookmarks while signed out, credential-free export and popup reopening. Firefox additionally reads its native menu and separators. No personal profiles are opened. Firefox's system-context permission is used only to open the installed extension's own popup page. The Firefox package command creates an XPI with `manifest.json` at its archive root; an archive containing a top-level `firefox/` directory is invalid.

Screenshots and results are written to `output/verification/chromium-*` and `firefox-*`. These smoke tests intentionally require the unconfigured development backend; once Google credentials are configured, use the manual checklist for consent and signed-in behavior instead of expecting the missing-configuration assertion to pass.

## Manual login and sync checklist

Complete [Google OAuth setup](google-oauth-setup.md), build and load both extensions in disposable profiles with test bookmarks.

1. Sign in with Google in Chromium. Confirm account email, browser name and seeded bookmark counts. Close and reopen the popup during and after login; the background should complete the operation.
2. Sign in with the same account in Firefox. Confirm existing Firefox bookmarks remain unchanged until merge approval. Include overlapping URLs with different titles/folders, repeated local URLs, and new URLs. Approve and check that cloud titles/hierarchy and existing cloud duplicates survive, only new URLs are imported, and surplus local copies disappear. Retry and sign out/in to verify stable counts. Repeat in both directions for Chrome, Helium and Firefox.
3. Add, rename, move, reorder and delete native bookmarks in both browsers. Check convergence, exact URLs, Firefox menu mapping and separator retention. Repeat sync without edits and check no extra activity appears.
4. Pause one browser, make local changes, and resume. Check pending changes survive popup/background restarts and upload once. Test network loss and reconnection.
5. Delete a folder, restore it from Activity, and confirm its descendants return. Export from Settings and check it contains bookmark/recovery data without sessions or credentials.
6. Sign in with a different test Google account in a third profile; confirm a separate collection. Reauthentication on an existing installation must reject switching accounts until sign-out.
7. Revoke another browser, then try syncing it; native bookmarks should remain intact. Sign out and sign in again to reconnect to the same account's collection.
8. End/expire a Better Auth session using the development dashboard. Confirm the extension asks for Google login and retains queued edits. Reauthenticate with the same account and sync them.
9. Reinstall in a disposable profile and sign in again. Confirm the server collection is not reseeded and merging local bookmarks requires approval.

## Current verification

50 isolated tests, TypeScript and both builds pass. The built Chromium and installed Firefox 156 extensions each passed seven headless smoke checks on macOS. Google credentials are not available, so live Google consent, callback completion, session renewal and authenticated native browser-to-browser sync are **not yet verified**.

Minimum build targets (Chromium 120 / Firefox 128), Helium, other derivatives, Windows and Linux remain unverified. Before public release, test store installation, account-root changes, browser-vendor sync interactions, force-killed workers, long offline periods, large collections, retention/account deletion and signing.
