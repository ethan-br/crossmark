# Authenticated sync validation — 2026-11-07

Branch: `v01/live-sync-validation`. No personal browser profiles, bookmarks,
credentials or production deployments were used. No sync implementation changes
were needed for the scenarios exercised here.

## Automated evidence

`npm ci` completed. `npm test` passed **169 tests in 14 files**, including the four
new tests in `tests/authenticated-sync.test.ts`. `npm run build` passed TypeScript
checking and both Chromium and Firefox production builds.

The new tests connect actual Better Auth signup/signin/token HTTP handlers and
persisted database sessions to two independent Engine/Adapter/Store instances,
using Chromium-shaped and Firefox-shaped in-memory bookmark trees. They prove:

- Successful account creation, a separate same-account session, no replacement
  before confirmation, then replacement of the joining browser's local-only URL
  with the cloud URL including its query and fragment.
- Joining recovery retains the original local tree. Sign-out/rejoin retains that
  recovery and native IDs; repeated sync and rejoin make no create/remove calls.
- Offline auth transport failure leaves an edit queued. Restart and reconnect
  upload it, merging an independent concurrent URL change from the other engine
  with the offline title change.
- Operator password reset revokes real database sessions. A subsequent local
  edit remains queued and `needsSignIn` becomes true. Same-account login restores
  sync and the receiving tree contains exactly one copy of the edit.
- A mutation committed before its response is lost leaves a persisted outbox.
  Restart/retry clears it without duplicating the bookmark or activity entry.

These are integration tests, **not live browser end-to-end tests**. The test
bridge maps the JWT issued by the HTTP handler to convex-test's identity. It does
not verify the signature, use Convex's network transport, run PasswordSession's
extension storage, native bookmark APIs, or background worker subscriptions. Both
auth clients use the same trusted Chromium origin; Firefox origin validation is
not proved. Revocation is tested, rather than waiting for natural expiry. The
restart retains the test auth object; it is not an OS process kill.

The existing engine suite also passed its interrupted native create/removal,
projection recovery, independent field merge, pause/resume, missed-event,
retry, initialization and stable mapping cases. Those remain simulated tests.

`npm run test:browser` passed its **seven native Chromium smoke checks**, in a
disposable Playwright profile: startup, native read, welcome/signin UI, failed
signin reporting, bookmarks preserved while signed out, credential-free export,
and popup reload. Evidence is generated under `output/verification/chromium-*`
(ignored by git). This smoke does not test successful login.

## External blockers and unverified release requirements

`npm run test:firefox` failed during browser startup, before installing the
extension, with `InvalidArgumentError: binary is not a Firefox executable`.
`/usr/bin/firefox` exists, but Selenium could not launch it. A launchable Firefox
binary supplied through `FIREFOX_BINARY` is needed to retry.

No `.env.local` or deployment selection was present in this worktree, and the
local Convex functions endpoint `http://127.0.0.1:3210` refused connection (curl
HTTP status `000`). No existing remote backend was selected or modified. A
configured disposable Convex deployment, its auth secret and trusted Chromium
and disposable Firefox origins are needed for live validation.

Consequently **successful authenticated native Chromium–Firefox sync has not
passed**. The manual checklist in [test-plan.md](test-plan.md) remains a release
requirement, including both-direction native CRUD/reorder, Firefox menu and
separator behavior, live updates before the alarm, offline/reconnect, actual
session expiry/renewal, interrupted native writes/process kills, joining and
rejoining native ID stability, remote pause, and account-root replacement.
Do not treat the new integration tests or signed-out smoke as that evidence.

## Integration considerations

Only a new test file and validation documentation are added; no production
protocol, adapter, auth, schema, dependency or retention behavior changes.
Recovery/account-lifecycle threads may have overlapping tests, but no production
files need conflict resolution. If auth token payload fields, Engine commands or
sync state change, update this bridge alongside those changes. Tests mint only
in-memory disposable accounts and do not require live secrets.
