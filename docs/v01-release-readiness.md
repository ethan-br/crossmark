# v0.1 production and package readiness

Read-only audit on 2026-11-07, starting at `8b67b35`. No deployment, release publication, AMO submission, secret change, or production data write was performed.

## Verdict

Local build and current Linux browser checks pass. This is not yet evidence that v0.1 can be shipped: the only published release is v0.0.4, and production auth configuration, upgrades and other desktop platforms still need verification. Coordinate store listing, installation instructions and update policy with the separate distribution workstream. These changes own only signing workflow/helper validation and this release evidence; no manifest, dependencies or application behavior changed.

## GitHub evidence

- Latest main [Test run](https://github.com/ethan-br/crossmark/actions/runs/36339825732) and [Package run](https://github.com/ethan-br/crossmark/actions/runs/36339825736) succeeded on September 27. November Dependabot runs do not establish current main application coverage.
- [v0.0.4 prerelease](https://github.com/ethan-br/crossmark/releases/tag/v0.0.4) has Chromium ZIP and signed Firefox XPI. [Manual signing](https://github.com/ethan-br/crossmark/actions/runs/36329260949) succeeded after the release-triggered run failed. [Production deploy](https://github.com/ethan-br/crossmark/actions/runs/36329659744) succeeded afterward. These historical runs do not validate unmerged v0.1 changes.
- Repository variables name `https://knowing-frog-670.convex.cloud` and matching `.convex.site`. Repository secret names include AMO issuer/secret; production environment contains a `CONVEX_DEPLOY_KEY` name. Values and credential validity were not inspected.
- The production environment has no protection rules or branch policy and permits admin bypass. Adding an approval gate is an operator decision; this audit did not change environment settings.
- Deploy is manual and validates a production key against paired URLs. Actual deployed `BETTER_AUTH_SECRET` and `AUTH_TRUSTED_ORIGINS`, schema compatibility and backend state were not inspected. Passing historical deployment is insufficient proof of those settings today.

## Artifact verification

Downloaded both v0.0.4 assets and matched their SHA-256 digests to GitHub metadata:

| Asset              | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| Chromium ZIP       | `2aeee569e2e30822792237a73a45c7a288fc806a6362f82d211e9c58bffe8bb4` |
| Firefox signed XPI | `5500a7c783da0ac9ae3be5475c7b80273e4aa97a58094ccc594171698deae872` |

Both manifests report 0.0.4 and the configured HTTPS backend origins. XPI contains Mozilla RSA and COSE signature files. Linux Firefox 159.0.1 accepted the XPI with Selenium `installAddon(path, false)` (permanent installation in a disposable profile), returned the expected Gecko ID, and successfully uninstalled it. This tests browser signature acceptance; no production sign-in was attempted.

Neither manifest declares an update URL. There is no GitHub automatic update feed. Firefox unlisted signing alone does not configure automatic updates, and the Chromium ZIP is an unpacked distribution archive. A v0.0.4 → v0.1 upgrade preserving bookmarks/account state remains untested; choose and document the distribution/update policy before claiming upgrade readiness.

## Local validation and fixes

Node 24.21.0 on Linux:

- `npm ci`, `npm run package`, and `npm run typecheck`: pass. Both unsigned archives produced.
- `npm test`: 171 tests across 15 files pass, including release URL and mocked signing regression checks. Signing tests never contact AMO.
- Playwright Chromium 153: seven extension smoke checks and debug privacy/storage/export checks pass.
- Firefox 159.0.1: seven extension smoke checks pass with `FIREFOX_BINARY=/snap/firefox/current/usr/lib/firefox/firefox`. Default `/usr/bin/firefox` is a shell wrapper and Selenium rejects it as “binary is not a Firefox executable.” CI supplies the setup action's real binary path.
- Firefox lint: zero errors/notices, four warnings. Two are data collection manifest keys introduced after the declared Firefox 128 minimum; two are generated bundle `innerHTML` warnings. These require review for store submission and minimum-version claims; no minimum version was raised speculatively.

Signing now checks out `refs/tags/...`, requires ancestry on main, and rejects missing, loopback or mismatched Convex release URLs. This checks origin shape/pairing, not whether the remote deployment is production. The helper deletes stale signed outputs, requires exactly one newly returned XPI, and reports spawn/output failures instead of silently copying an older artifact.

## Before release approval

1. Integrate all readiness work and run Test/Package against that exact commit, then select a new numeric v0.1 tag. Package version is still 0.0.3 locally; signing derives the release version from its tag.
2. Verify production auth configuration against both stable extension origins and validate schema compatibility with the backend owner.
3. Validate upgrade/reinstall persistence and explicitly document manual versus automatic updates with the distribution owner. Test actual minimum Chromium 120 / Firefox 128, Edge, macOS and Windows; only current Linux Chromium/Firefox were exercised here.
4. Review the Firefox lint warnings and any source-review/store requirements. Keep fresh AMO signing, deployment and publication behind explicit release authorization. A published release currently triggers signing automatically; manual dispatch also submits to AMO and uploads release assets.
