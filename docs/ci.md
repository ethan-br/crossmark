# CI and deployments

Crossmark has four GitHub Actions workflows. They are split so a failing AMO submission or a missing Convex key cannot block ordinary PR tests.

## Recommended triggers

| Workflow              | Trigger                                                                                                                                                                                    | Why                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Test**              | Every pull request and every push to `main`                                                                                                                                                | Isolated tests are cheap and should gate merge. Browser smoke is slower but is the only automated check of the real extension in a browser.                                                                                    |
| **Convex preview**    | Pull requests against this repository                                                                                                                                                      | Each branch gets a disposable backend. Reuse the preview on later pushes (`--preview-name`) so test data survives; do not recreate it on every commit. Fork PRs are skipped because they must not receive deploy keys.         |
| **Package**           | Unsigned zips on pull requests (and manual dispatch without **sign**). Signed artifacts on `main` when `package.json` version changes, on `v*` tags, and on manual dispatch with **sign**. | PR zips prove layout without talking to AMO. Pushes to `main` never upload an unsigned XPI. Signing submits to Mozilla, so the version must change between submissions and AMO credentials must not run on untrusted branches. |
| **Convex production** | Push to `main`                                                                                                                                                                             | `main` is the production backend. Do not deploy production from pull requests.                                                                                                                                                 |

Do not combine preview and production keys in one secret. GitHub Environments keep them apart: the production workflow uses the `production` environment.

## One-time GitHub setup

### Secrets

| Secret                      | Where                              | Value                                                                                                                |
| --------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `CONVEX_PREVIEW_DEPLOY_KEY` | Repository secrets                 | Convex **preview** deploy key (`preview:team:project\|…`) from the project settings page. Grant `deployment:deploy`. |
| `CONVEX_DEPLOY_KEY`         | **production** environment secrets | Convex **production** deploy key.                                                                                    |
| `AMO_JWT_ISSUER`            | Repository secrets                 | AMO API key issuer, only needed to sign Firefox.                                                                     |
| `AMO_JWT_SECRET`            | Repository secrets                 | AMO API key secret.                                                                                                  |

### Variables

| Variable               | Where                | Value                                                            |
| ---------------------- | -------------------- | ---------------------------------------------------------------- |
| `VITE_CONVEX_URL`      | Repository variables | Production functions origin, `https://<deployment>.convex.cloud` |
| `VITE_CONVEX_SITE_URL` | Repository variables | Production HTTP origin, `https://<deployment>.convex.site`       |

PR unsigned-package jobs still succeed if those variables are unset: the extension falls back to loopback URLs, which is enough to prove the zip layout. Signed builds on `main` and tags fail until the production URLs are set, so a signed XPI cannot ship pointed at `127.0.0.1`.

Create the `production` GitHub Environment (Settings → Environments) and add `CONVEX_DEPLOY_KEY` there. Until that secret exists, the production workflow is skipped instead of failing `main`. Optional later: required reviewers on that environment before production deploys.

The preview job is likewise skipped until `CONVEX_PREVIEW_DEPLOY_KEY` is set, and it never runs on fork pull requests.

## Convex preview defaults

New preview deployments copy **project default** environment variables for the `preview` type. Set these once from a machine already logged into Convex:

```sh
npx convex env default set --type preview BETTER_AUTH_SECRET '…'
npx convex env default set --type preview AUTH_TRUSTED_ORIGINS 'chrome-extension://eblopgfhjccjncfjmgcjfahaggkcolok'
```

Use a dedicated Better Auth secret for previews, not the production value. Append any Firefox `moz-extension://` origins you test previews with; see [login setup](auth-setup.md#3-configure-trusted-origins). Each preview has its own user table, so create a test account on it.

Isolated tests and headless smoke checks do not need a backend. The Vitest job (`npm test`) uses WXT's fake-browser setup and never opens a browser profile or prompts for OAuth.

Idle previews expire (5 days on Free/Starter, 14 days on paid plans) and count toward the team's deployment limit.

## Firefox signing

`npm run sign:firefox` submits an **unlisted** XPI through Mozilla's signing API. Use it for self-distributed testing, not store listing.

Bump `package.json` `version` before each successful submission. Re-signing the same version is rejected or confusing on AMO. A push to `main` signs only when that version string changed; other `main` pushes produce no package artifacts. Tags and manual **sign** runs always submit.

Trigger signing by bumping the version and merging to `main`, by pushing a matching tag:

```sh
git tag v0.0.4
git push origin v0.0.4
```

or **Actions → Package → Run workflow** with **sign** enabled. Store listing (`wxt submit`) is a later step and needs Chrome/Firefox listing credentials plus a sources zip; this repo's local `package:firefox` path still sets `zipSources: false` because that archive is for temporary install, not source review.

## Local commands that match CI

```sh
npm run typecheck
npm test
npm run build
npm run package
```

Browser smoke still expects the unconfigured local backend. See [the test plan](test-plan.md).

Development browsers: `npm run dev` / `npm run dev:firefox` open Chrome and Firefox binaries discovered from `CHROME_BINARY` / `FIREFOX_BINARY` or standard install paths. Set `WXT_OPEN_BROWSER=0` to skip launching a window. Personal persistent profiles belong in the ignored `web-ext.config.ts`, not in `wxt.config.ts`.
