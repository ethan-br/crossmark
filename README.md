# Crossmark v0

Keep your bookmarks in sync across desktop browsers with the Crossmark extension for Chromium and Firefox. Sign in with an email and password. Crossmark syncs while your browsers are running.

## Build and install

Use Node.js 22 or newer:

```sh
npm install
npm run backend
```

For a local Convex deployment, choose **Start without an account** on first run and keep the backend running. Convex writes `.env.local`; make sure it contains both public endpoints:

```dotenv
VITE_CONVEX_URL=http://127.0.0.1:3210
VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
```

In another terminal:

```sh
npm run build
```

WXT builds both Manifest V3 extensions. To build only one browser, use `npm run build:chromium` or `npm run build:firefox`. Production builds read `.env.local` and `.env.production`; shell variables take precedence. The existing `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` names and loopback defaults are unchanged.

- **Chromium / Chrome / Helium:** open the extensions manager, enable Developer mode, choose **Load unpacked**, and select `dist/chromium`.
- **Firefox development install:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`. Do not select the folder or use Firefox's Add-ons Manager for this step. Temporary installations disappear at browser shutdown.
- **Firefox package:** run `npm run package:firefox`. This creates `dist/crossmark-firefox.xpi` with `manifest.json` at the archive root. The archive is suitable for testing through **Load Temporary Add-on**. A normal Firefox release will reject an unsigned development XPI with “appears to be corrupt”; permanent installation requires signing/distribution through [addons.mozilla.org](https://addons.mozilla.org/developers/).

To create a signed, self-distributed Firefox package, create AMO API credentials at [AMO API keys](https://addons.mozilla.org/developers/addon/api/key/), then run:

```sh
export AMO_JWT_ISSUER='your-amo-jwt-issuer'
export AMO_JWT_SECRET='your-amo-jwt-secret'
npm run sign:firefox
```

The signed XPI is written under `dist/signed/` and copied to `dist/crossmark-firefox-signed.xpi`. `web-ext sign` submits the package to Mozilla's Add-ons signing service; the signature cannot be generated entirely offline. Keep both variables out of Git and out of the browser extension.

For use on a remote computer, configure a Convex cloud deployment and rebuild with its public HTTPS endpoints; see [login setup](docs/auth-setup.md).

## Local development

Keep the backend running, then start WXT in another terminal:

```sh
npm run dev          # Chromium/Chrome
npm run dev:firefox  # Firefox
```

WXT opens the extension in a disposable browser profile and reloads it as files change. Development builds use `dist/chromium-dev` and `dist/firefox-dev`, separately from production artifacts. The popup supports React hot updates; background changes restart the extension. There is no standalone web preview or preview tunnel.

`npm run dev` opens Google Chrome when it is installed at the usual macOS, Linux, or Windows path; `npm run dev:firefox` opens Firefox the same way. Override with `CHROME_BINARY` / `CHROMIUM_BINARY` or `FIREFOX_BINARY`. Set `WXT_OPEN_BROWSER=0` to build the dev extension without launching a window. Personal persistent profiles belong in an ignored `web-ext.config.ts`; see [the WXT migration guide](docs/wxt-migration.md). `npm install` generates ignored WXT types automatically; `npm run typecheck` regenerates them when needed.

## Login setup

Login uses an email and password stored by Better Auth in Convex. The backend needs `BETTER_AUTH_SECRET` and `AUTH_TRUSTED_ORIGINS` (the extension origins); follow [the setup guide](docs/auth-setup.md). Do not put backend secrets in a `VITE_` or `WXT_` variable or extension file.

Create an account in the first browser, then sign in with the same email and password in each other browser. A new account starts with its first browser’s bookmarks. When connecting to an existing account, choose which bookmarks to keep:

- **Use synced bookmarks:** replace this browser’s bookmarks with the account’s synced bookmarks.
- **Use this browser’s bookmarks:** replace the account’s synced bookmarks with this browser’s bookmarks. This also replaces bookmarks on all other connected browsers.

There is no merge option. Individual bookmark edits sync normally after connecting.

Crossmark keeps this browser’s original bookmarks from before its first connection, even across reconnects and account changes. **Disconnect and restore** removes this browser from sync before restoring those original bookmarks. It stays disconnected until you sign in and choose which bookmarks to keep again. Signing out alone leaves current bookmarks in place. See [connecting and restoring bookmarks](docs/bookmark-recovery.md) for retry, cancellation and recovery limits.

Avoid connecting two browsers that already sync bookmarks with each other through Chrome, Firefox or another browser’s own sync service: this can create duplicates.

## Included

- Chromium and Firefox Manifest V3 builds, native bookmark/folder edits, moves, ordering and deletion.
- Email/password login, account-scoped collection access and browser revocation.
- Durable local operations, idempotent uploads, startup reconciliation and native-write recovery journals.
- First-browser initialization, joining replacement and large-change approval.
- Overview, activity, browser status, pause/resume and export.
- Firefox menu/separator handling and Chromium menu-folder projection.
- Live Convex subscriptions trigger remote sync; a 30-second alarm catches missed updates after sleep or disconnection.

Collections are capped at 2,000 snapshot records, 600,000 UTF-8 JSON bytes and 10 connected browsers. Deleted identities move to permanent compact fences so bookmark churn does not exhaust snapshot capacity. See [capacity and retention](docs/capacity-retention.md). The server processes bookmark data; end-to-end encryption is not implemented. Settings supports password-confirmed account deletion, and sign-in supports emailed password reset when Resend is configured. Large-account deletion capacity, store signing, hosted production deployment and full compatibility certification remain release work. History expires after 30 days and server backups after seven days; expiry runs hourly in bounded batches. Minimum build targets are Chromium 120 and Firefox 128.

## Verify

Run:

```sh
npm run check
npx playwright install chromium
npm run test:browser
npm run test:firefox
```

Headless tests load the actual extension builds in disposable profiles. They verify startup, native bookmark reads, the email/password login screen, failed-login handling, export and popup reopening. Firefox also checks native menu and separator reads. They do **not** claim a successful login or authenticated browser-to-browser sync; follow the [manual login and sync checklist](docs/test-plan.md).

`npm test` also checks the sync engine, adapters, the real Better Auth sign-up/sign-in routes, build endpoint validation, background messaging boundaries and account authorization in isolation through Vitest + WXT's fake-browser setup. These fixtures are test-only and are not included in either extension. On macOS Firefox smoke tests default to `/Applications/Firefox.app/Contents/MacOS/firefox`; override with `FIREFOX_BINARY` if needed. Selenium obtains geckodriver on its first run. Results and screenshots are in `output/verification/`. `npm run test:debug` checks the built Chromium debug controls without a backend (see [validation](docs/test-plan.md)).

GitHub Actions runs typecheck, unit tests, browser smokes and unsigned packaging on every pull request and push to `main`. Deploy the production Convex functions manually from a release tag before publishing its GitHub release; publishing then builds packages at the tag's version and signs Firefox through AMO. See [CI and releases](docs/ci.md).

## Debugging

An opt-in background-console mode provides structured diagnostics, JSON export and local clearing without a rebuild. See [extension debug mode](docs/debugging.md) for the toggle, supported consoles and privacy details.

## Project map

| Path                                   | Responsibility                                                    |
| -------------------------------------- | ----------------------------------------------------------------- |
| `apps/extension/src/main.tsx`          | Extension popup shell: state, tabs and confirmations              |
| `apps/extension/src/popup`             | Popup views (overview, activity, browsers, settings, sign-in)     |
| `apps/extension/components/ui`         | shadcn/ui components used by the popup                            |
| `apps/extension/src/auth.ts`           | Email/password sign-in and private session storage                |
| `apps/extension/entrypoints`           | WXT background and popup entrypoints                              |
| `apps/extension/src/engine.ts`         | Registration, durable queue, reconciliation and recovery          |
| `apps/extension/src/adapter.ts`        | Browser roots and native projection                               |
| `packages/model`, `packages/sync-core` | Canonical records, diffs and conflict rules                       |
| `convex`                               | Better Auth component, account authorization, sync and history    |
| `apps/extension/manifest.ts`           | Shared permissions, backend origins and browser-specific settings |
| `apps/extension/public/icons`          | Extension icons copied by WXT                                     |
| `wxt.config.ts`                        | WXT builds, development browsers, packaging                       |
| `.github/workflows`                    | Test, package, production deploy, release signing and Pullfrog    |
| `docs`                                 | Setup, architecture, privacy, CI and validation                   |

Bookmark exports and Disconnect and restore are available in Settings. See [the recovery procedure and limits](docs/bookmark-recovery.md).
