# Crossmark v0

Native desktop bookmark synchronization through Convex, with a WXT-based Chromium/Firefox extension and Google login through Convex Better Auth. Sync runs in the extension background.

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

For use on a remote computer, configure a Convex cloud deployment and rebuild with its public HTTPS endpoints; see [Google OAuth setup](docs/google-oauth-setup.md).

## Local development

Keep the backend running, then start WXT in another terminal:

```sh
npm run dev          # Chromium/Chrome
npm run dev:firefox  # Firefox
```

WXT opens the extension in a disposable browser profile and reloads it as files change. Development builds use `dist/chromium-dev` and `dist/firefox-dev`, separately from production artifacts. The popup supports React hot updates; background changes restart the extension. There is no standalone web preview or preview tunnel.

`npm run dev` opens Google Chrome when it is installed at the usual macOS, Linux, or Windows path; `npm run dev:firefox` opens Firefox the same way. Override with `CHROME_BINARY` / `CHROMIUM_BINARY` or `FIREFOX_BINARY`. Set `WXT_OPEN_BROWSER=0` to build the dev extension without launching a window. Personal persistent profiles belong in an ignored `web-ext.config.ts`; see [the WXT migration guide](docs/wxt-migration.md). `npm install` generates ignored WXT types automatically; `npm run typecheck` regenerates them when needed.

## Google OAuth setup

**A Google OAuth web client has not been created yet.** The extension installs and opens, but Google sign-in requires backend configuration. Follow [the setup guide](docs/google-oauth-setup.md) to create the client, configure Convex secrets and trusted origins, and test the complete login flow. Do not put the Google client secret in a `VITE_` or `WXT_` variable or extension file.

Sign in with the same Google account in each browser. The first installation initializes the account's collection from its native bookmarks. Additional installations find that collection automatically. Additional browsers replace their existing user bookmarks under the portable roots with the cloud collection automatically. The previous local snapshot is included in the recovery export. Signing out does not delete native bookmarks or the account's server collection.

Use one Crossmark installation per independently native-synced collection. Connecting installations already exchanging bookmarks through a browser vendor's sync can introduce duplicates.

## Included

- Chromium and Firefox Manifest V3 builds, native bookmark/folder edits, moves, ordering and deletion.
- Google-only login, account-scoped collection access and browser revocation.
- Durable local operations, idempotent uploads, startup reconciliation and native-write recovery journals.
- First-browser initialization, cloud replacement on later browsers and large-change approval.
- Overview, activity, browser status, pause/resume, export and earlier-version restore.
- Firefox menu/separator handling and Chromium menu-folder projection.
- Remote polling every 30 seconds, subject to browser sleep and scheduling.

Collections are capped at 2,000 records including tombstones, 600 KB and 10 connected browsers. The server processes bookmark data; end-to-end encryption is not implemented. Account deletion, retention limits, backup import, store signing, hosted production deployment and full compatibility certification remain future work. History and backups currently have no automatic expiry. Minimum build targets are Chromium 120 and Firefox 128.

## Verify

Keep the local backend running. Before configuring Google, run:

```sh
npm run check
npx playwright install chromium
npm run test:browser
npm run test:firefox
```

Headless tests load the actual extension builds in disposable profiles. They verify startup, native bookmark reads, the Google-only login screen, unconfigured-login handling, export and popup reopening. Firefox also checks native menu and separator reads. They do **not** claim live Google login or authenticated browser-to-browser sync. After OAuth setup, follow the [manual login and sync checklist](docs/test-plan.md).

`npm test` also checks the sync engine, adapters, OAuth callback validation, build endpoint validation and account authorization in isolation. These fixtures are test-only and are not included in either extension. On macOS Firefox smoke tests default to `/Applications/Firefox.app/Contents/MacOS/firefox`; override with `FIREFOX_BINARY` if needed. Selenium obtains geckodriver on its first run. Results and screenshots are in `output/verification/`. `npm run test:debug` checks the built Chromium debug controls without a backend; `npm run test:firefox-auth` checks the Firefox identity flow against its local fixture (see [validation](docs/test-plan.md)).

GitHub Actions runs typecheck, unit tests and both browser smokes on every pull request. Pull requests from this repository also get a Convex preview deployment and unsigned zips baked against that backend. Pushes to `main` never upload an unsigned package; they sign Firefox when `package.json` version changes. See [CI and deployments](docs/ci.md).

## Debugging

An opt-in background-console mode provides structured diagnostics, JSON export and local clearing without a rebuild. See [extension debug mode](docs/debugging.md) for the toggle, supported consoles and privacy details.

## Project map

| Path                                   | Responsibility                                                    |
| -------------------------------------- | ----------------------------------------------------------------- |
| `apps/extension/src/main.tsx`          | Extension popup                                                   |
| `apps/extension/src/auth.ts`           | Google OAuth launch and private session storage                   |
| `apps/extension/entrypoints`           | WXT background and popup entrypoints                              |
| `apps/extension/src/engine.ts`         | Registration, durable queue, reconciliation and recovery          |
| `apps/extension/src/adapter.ts`        | Browser roots and native projection                               |
| `packages/model`, `packages/sync-core` | Canonical records, diffs and conflict rules                       |
| `convex`                               | Better Auth component, account authorization, sync and history    |
| `apps/extension/manifest.ts`           | Shared permissions, backend origins and browser-specific settings |
| `apps/extension/public/icons`          | Extension icons copied by WXT                                     |
| `wxt.config.ts`                        | WXT builds, development browsers, packaging                       |
| `.github/workflows`                    | Test, Convex preview/production and package/sign jobs             |
| `docs`                                 | Setup, architecture, privacy, CI and validation                   |
