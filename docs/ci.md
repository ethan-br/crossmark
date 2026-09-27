# CI and releases

Crossmark has four build and release workflows:

| Workflow                     | Trigger                               | Output                                                                |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| **Test**                     | Every pull request and push to `main` | Typecheck, unit tests, and browser smoke checks                       |
| **Package**                  | Every pull request and push to `main` | Unsigned Chromium ZIP and Firefox XPI as workflow artifacts           |
| **Deploy Convex production** | Manual run with a release tag         | Convex functions from that tag deployed to production                 |
| **Sign release**             | Publishing a GitHub release           | Chromium ZIP and AMO-signed Firefox XPI attached after the job passes |

The package workflow uses `npm run package`, which runs `wxt zip` for Chromium and `wxt zip -b firefox` for Firefox. It uses the version in the checked-in `package.json`. Production backend URLs come from the repository variables `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`. If they are absent, unsigned packages use the loopback fallback and remain useful for build validation.

## GitHub setup

Set these repository variables to the production functions and HTTP origins:

| Variable               | Example                             |
| ---------------------- | ----------------------------------- |
| `VITE_CONVEX_URL`      | `https://<deployment>.convex.cloud` |
| `VITE_CONVEX_SITE_URL` | `https://<deployment>.convex.site`  |

Set `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` as repository secrets. The sign workflow requires all four values and fails before building if any are missing. AMO credentials are only used by the release workflow.

Create a `production` GitHub environment with a `CONVEX_DEPLOY_KEY` environment secret for the production Convex deployment. Use a production deployment key, whose value starts with `prod:`. Configure `BETTER_AUTH_SECRET` and `AUTH_TRUSTED_ORIGINS` on that deployment, and set the repository's `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` to its matching `convex.cloud` and `convex.site` origins. The deploy workflow checks that the key and both origins name the same deployment. It runs only when manually dispatched; it does not create a Convex deployment or configure its environment variables.

## Make a signed release

1. Choose a commit on `main` with passing tests, and create and push a numeric tag such as `v0.0.4` (or `0.0.4`).
2. In **Actions → Deploy Convex production → Run workflow**, enter that tag. Wait for the run to succeed. It checks out the tag and deploys its `convex/` functions to production. This keeps the backend and extension on the same commit.
3. Create and publish a GitHub release for the same tag. The sign workflow runs tests, sets the build version from the tag, packages both browsers, verifies both manifest versions, and submits Firefox for unlisted AMO signing. Wait for the workflow to succeed before sharing the release assets.

The successful sign workflow attaches `crossmark-firefox-signed.xpi` and `crossmark-chromium.zip` to the release. Use the signed XPI for permanent Firefox installation; the unsigned XPI from Package is for temporary installation and build validation. A GitHub prerelease can use a numeric tag, but tags with a suffix such as `-beta.1` are not accepted as extension versions.

The release tag controls the packaged version even if the checked-in `package.json` has a different version. Use a new version for each AMO submission; rerunning a successful release with the same version may be rejected by AMO. Pushes to `main` and tag pushes alone never submit to AMO. Assets appear only after the sign workflow finishes. If it fails after signing, download the `extension-signed` workflow artifact and add any missing asset to the release. Existing release assets are never overwritten by the workflow. If signing fails after the backend deploy, rerun **Deploy Convex production** with the previous release tag to restore its functions, after checking that its schema remains compatible with production data.

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
