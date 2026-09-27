# CI and releases

Crossmark has three build and release workflows:

| Workflow         | Trigger                               | Output                                                                                          |
| ---------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Test**         | Every pull request and push to `main` | Typecheck, unit tests, and browser smoke checks                                                 |
| **Package**      | Every pull request and push to `main` | Unsigned Chromium ZIP and Firefox XPI as workflow artifacts                                     |
| **Sign release** | Publishing a GitHub release           | Chromium ZIP and AMO-signed Firefox XPI attached to the release and saved as workflow artifacts |

The package workflow uses `npm run package`, which runs `wxt zip` for Chromium and `wxt zip -b firefox` for Firefox. It uses the version in the checked-in `package.json`. Production backend URLs come from the repository variables `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`. If they are absent, unsigned packages use the loopback fallback and remain useful for build validation.

## GitHub setup

Set these repository variables to the production functions and HTTP origins:

| Variable               | Example                             |
| ---------------------- | ----------------------------------- |
| `VITE_CONVEX_URL`      | `https://<deployment>.convex.cloud` |
| `VITE_CONVEX_SITE_URL` | `https://<deployment>.convex.site`  |

Set `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` as repository secrets. The sign workflow requires all four values and fails before building if any are missing. AMO credentials are only used by the release workflow.

## Make a signed release

Create and publish a GitHub release with a numeric tag such as `v0.0.4` (or `0.0.4`). The tag must point to the commit being released. The workflow checks out that tag, sets the build version from the tag, packages both browsers, verifies both manifest versions, and submits Firefox for unlisted AMO signing. It then attaches `crossmark-chromium.zip` and `crossmark-firefox-signed.xpi` to the release.

The release tag controls the packaged version even if the checked-in `package.json` has a different version. Use a new version for each AMO submission; rerunning a successful release with the same version may be rejected by AMO. Pushes to `main` and tag pushes alone never submit to AMO.

Store listing (`wxt submit`) is a separate step and needs store credentials plus a sources zip. This project's local package command sets `zipSources: false` because the unsigned archive is for testing rather than source review.

## Local commands that match CI

```sh
npm run typecheck
npm test
npm run build
npm run package
```

Browser smoke checks expect the unconfigured local backend. See [the test plan](test-plan.md).

Development browsers: `npm run dev` / `npm run dev:firefox` open Chrome and Firefox binaries discovered from `CHROME_BINARY` / `FIREFOX_BINARY` or standard install paths. Set `WXT_OPEN_BROWSER=0` to skip launching a window. Personal persistent profiles belong in the ignored `web-ext.config.ts`, not in `wxt.config.ts`.
