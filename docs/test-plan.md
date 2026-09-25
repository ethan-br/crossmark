# Validation

Product testing uses WXT-built extensions: automated headless browser runs or manual installation. WXT's development server supports extension reloads; there is no standalone simulated web page or preview tunnel.

## Automated checks

`npm run check` performs TypeScript checking, the isolated test suite and both extension builds. The tests cover:

- Better Auth session validation, expired/unauthenticated sessions, Google account isolation on reads/writes/revocation, idempotent initialization and same-account joining.
- OAuth callback origin/path/nonce checks, rejecting non-Google authorization URLs, private session transfer, JWT use, missing configuration and expired session cleanup. Client transport tests use mocks. Separate tests exercise the real Better Auth HTTP routes for Google authorization URL generation, identity scopes, redirect validation, and disabled password login; they do not complete live Google OAuth.
- Independent field merges, tombstones, cycles, native convergence, automatic cloud replacement, pause/resume, missed events, crash journals, root disappearance, mass deletion, upload retries, interrupted initialization and edits during projection.
- Extension backend origin validation, loopback defaults and network permission/CSP configuration for both browsers.

With the local backend running and Google credentials absent, `npm run test:browser` and `npm run test:firefox` install the actual builds in disposable profiles. Each checks startup, native reads, Google-only sign-in UI, a useful missing-configuration error, preservation of bookmarks while signed out, credential-free export and popup reopening. Firefox additionally reads its native menu and separators. No personal profiles are opened. Firefox's system-context permission is used only to open the installed extension's own popup page. The Firefox package command creates an XPI with `manifest.json` at its archive root; an archive containing a top-level `firefox/` directory is invalid.

Screenshots and results are written to `output/verification/chromium-*` and `firefox-*`. These smoke tests intentionally require the unconfigured development backend; once Google credentials are configured, use the manual checklist for consent and signed-in behavior instead of expecting the missing-configuration assertion to pass.

`npm run test:debug` tests the built Chromium background diagnostics without a backend. `npm run test:firefox-auth` starts its own loopback HTTP fixture on ports 3210/3211 and exercises Firefox's real identity API, provider-denied callbacks and configuration errors. For that test, stop any local backend on those ports and build with the fixture endpoints first:

```sh
VITE_CONVEX_URL=http://127.0.0.1:3210 VITE_CONVEX_SITE_URL=http://127.0.0.1:3211 npm run build:firefox
npm run test:firefox-auth
```

This fixture requires no Google credentials and never completes live sign-in. `npm run package:firefox` and `npm run lint:firefox` validate WXT's unsigned XPI and Mozilla manifest compatibility; live signing is a separate step requiring AMO credentials. Pull-request CI runs the isolated suite and both headless smokes; see [CI and deployments](ci.md). See [WXT migration](wxt-migration.md) for production/dev paths and environment precedence.

## Manual login and sync checklist

Complete [Google OAuth setup](google-oauth-setup.md), build and load both extensions in disposable profiles with test bookmarks.

1. Sign in with Google in Chromium. Confirm account email, browser name and seeded bookmark counts. Close and reopen the popup during and after login; the background should complete the operation.
2. Sign in with the same account in Firefox. Confirm its existing user bookmarks under toolbar, other and menu are replaced by the cloud tree, including cloud duplicates and separators. Verify managed roots are untouched and the previous local snapshot is available in export. Repeat in both directions for Chrome, Helium and Firefox.
3. Add, rename, move, reorder and delete native bookmarks in both browsers. Check convergence, exact URLs, Firefox menu mapping and separator retention. Repeat sync without edits and check no extra activity appears.
4. Pause one browser, make local changes, and resume. Check pending changes survive popup/background restarts and upload once. Test network loss and reconnection.
5. Delete a folder, restore it from Activity, and confirm its descendants return. Export from Settings and check it contains bookmark/recovery data without sessions or credentials.
6. Sign in with a different test Google account in a third profile; confirm a separate collection. Reauthentication on an existing installation must reject switching accounts until sign-out.
7. Revoke another browser, then try syncing it; native bookmarks should remain intact. Sign out and sign in again to reconnect to the same account's collection.
8. End/expire a Better Auth session using the development dashboard. Confirm the extension asks for Google login and retains queued edits. Reauthenticate with the same account and sync them.
9. Reinstall in a disposable profile and sign in again. Confirm the server collection is not reseeded and local bookmarks are replaced automatically.

## Current verification

The isolated tests, TypeScript and both production builds pass, including from a fresh `npm ci`. The built Chromium and installed Firefox 156 extensions each passed seven headless smoke checks on macOS against an unconfigured-backend HTTP fixture during the WXT migration. Chromium debug checks and the Firefox identity/denied-callback fixture passed. Firefox lint reported zero errors and four warnings (minimum-version data collection declarations and bundled React `innerHTML` use).

Live Google consent, successful callback completion, session renewal, authenticated native browser-to-browser sync and AMO signing were **not exercised by the migration checks**. Follow the manual checklist before release.

Minimum build targets (Chromium 120 / Firefox 128), Helium, other derivatives, Windows and Linux remain unverified. Before public release, test store installation, account-root changes, browser-vendor sync interactions, force-killed workers, long offline periods, large collections, retention/account deletion and signing.
