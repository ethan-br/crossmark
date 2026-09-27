# Contributing to Crossmark

This guide defines how Crossmark changes should be committed and proposed for
review. It is intentionally based on the commit and pull-request conventions
used by [T3 Code](https://github.com/pingdotgg/t3code), adapted to Crossmark's
browser-sync product and planned workspace.

The short version:

- Use plain-language Conventional Commit titles.
- Keep each commit and pull request focused on one concern.
- Describe the problem before describing the fix.
- Include the smallest meaningful verification and any required visual evidence.
- Treat the merged pull request as the implementation record.

## Branches

Start from the current `main` branch and use a short, descriptive branch name:

```text
feat/<short-description>
fix/<short-description>
perf/<short-description>
refactor/<short-description>
docs/<short-description>
test/<short-description>
chore/<short-description>
```

When an issue number is useful, put it after the branch type:

```text
fix/42-retain-delete-tombstones
```

Do not develop directly on `main`. Keep a branch limited to the concern that
will be reviewed in its pull request. A necessary test, migration, or small
documentation update belongs in the same branch when it supports that concern;
unrelated cleanup belongs elsewhere.

## Commit messages

### Format

Use this format, with the scope omitted when no single area is the clear owner:

```text
<type>(<scope>): <plain-language outcome>
```

Examples:

```text
feat(extension): sync bookmark moves across browsers
fix(sync-core): retain tombstones after offline deletes
perf(sync-service): batch change acknowledgements
refactor(adapter-firefox): isolate native root mapping
test(sync-core): cover delete-versus-edit conflicts
docs: document the commit and pull request workflow
```

The type describes the purpose of the change:

| Type | Use it for |
| --- | --- |
| `feat` | New user-visible or supported product behavior |
| `fix` | A correction to behavior that should already work |
| `perf` | A measured performance, resource, or latency improvement |
| `refactor` | Internal restructuring without an intended behavior change |
| `test` | Tests, fixtures, or test infrastructure when no product code changes |
| `docs` | Documentation-only changes |
| `chore` | Maintenance that does not fit the other categories |
| `build` | Packaging or build-system changes |
| `ci` | Continuous-integration workflow changes |

Use the scope for the primary Crossmark area affected. Prefer the directory or
boundary that owns the behavior:

| Scope | Typical responsibility |
| --- | --- |
| `extension` | Browser extension UI, background entry points, or permissions |
| `sync-core` | Reconciliation, conflicts, queues, journals, and recovery |
| `sync-service` | Authentication, devices, collections, and transport |
| `protocol` | Versioned wire contracts and validation |
| `model` | Canonical bookmark and operation data |
| `adapter-chromium` | Chromium bookmark API translation |
| `adapter-firefox` | Firefox bookmark API translation |
| `infra` | Deployment and operational configuration |

Use no scope for a genuinely cross-cutting change. Do not invent a scope just
to make a title look more specific.

### Writing the subject

- Keep the subject concise and readable; the first line should stand on its own
  in `git log` and a release note.
- Use plain language and describe the result or user-observable behavior, not
  the implementation mechanics.
- Begin the subject after the colon with lowercase, as in the examples above.
- Use present-tense action language: `retain`, `show`, `prevent`, `add`, or
  `remove`.
- Do not end the subject with a period.
- Avoid empty subjects such as `update code`, `fix stuff`, `changes`, or `WIP`.
- Do not combine unrelated changes in one commit.

Good:

```text
fix(sync-core): prevent offline devices from resurrecting deleted bookmarks
```

Less useful:

```text
fix(sync-core): update reconciliation logic
```

Add a commit body when the reason, constraint, migration, compatibility impact,
or trade-off will matter to someone reading the history later. The subject is
the summary; the body should add context rather than repeat it.

For a breaking public contract or migration, mark it clearly with `!` and
explain the impact and upgrade path in the body. For example:

```text
feat(protocol)!: require versioned operation envelopes

Older clients must upgrade before they can upload operations. The service
continues to accept the previous envelope during the documented migration
window.
```

Keep implementation and its focused tests together when possible. Separate
pure formatting or drive-by cleanup from a behavioral change so reviewers can
see the proof for the behavior being changed.

### Files that do not belong in a commit

Never commit credentials, access tokens, browser profile data, local secrets,
or real users' bookmark URLs and titles. Commit generated files only when they
are a deliberate, reproducible project artifact and the pull request explains
why they are tracked.

Screenshots and videos made only to demonstrate a pull request are evidence,
not source files. Upload them to the pull request and do not add a
`.github/pr-assets/` directory or equivalent PR-only asset directory to the
repository.

## Pull requests

Opening a pull request is an explicit publishing action. Do not create one
automatically merely because a branch has changes; open it when the author or
maintainer has asked for review or the agreed contribution workflow calls for
it.

### One concern per pull request

Each pull request should have one coherent purpose. A feature may include its
implementation, tests, schema changes, and user-facing documentation when
those pieces are required for that feature. It should not also contain an
unrelated refactor, cleanup, or second bug fix.

If the description needs to say “also” to introduce a separate goal, stop and
consider splitting the work. Smaller focused pull requests are easier to test,
review, revert, and release.

### Pull-request title

Use the same Conventional Commit format as a commit subject:

```text
<type>(<scope>): <plain-language outcome>
```

The title should be suitable as the subject of the eventual merge commit. It
should tell a reader what changed without requiring them to open the diff:

```text
feat(extension): initialize a new collection from the first browser
fix(adapter-chromium): preserve separate local and account bookmark roots
fix(sync-core): recover edits that race with a remote delete
docs: define commit and pull request conventions
```

Put issue links, tracking numbers, and implementation detail in the body unless
the repository's hosting workflow requires them in the title.

### Pull-request description

Start with the problem in one or two sentences, then explain how the change
solves it. Use this template:

```markdown
## Problem

<!-- What was wrong, missing, or at risk? State the user or maintainer impact. -->

## Fix

<!-- What changed, and why does it address the problem? Mention important
     compatibility, data-integrity, privacy, or migration decisions. -->

## Verification

- [ ] `command or test` — result
- [ ] `command or test` — result
- [ ] Manual scenario, if applicable — result

## Evidence

<!-- For UI changes, add before/after screenshots.
     For motion or timing changes, add a short video.
     Otherwise write: No visual evidence needed. -->

## Risk and rollout

<!-- State notable risks, feature flags, migrations, rollback notes, or say
     "No special rollout considerations." -->

## Tracking

<!-- Link the issue, design decision, or plan when one exists. -->

Closes #123

---
Model/harness: <model> / <harness>
```

The final attribution line is intentional. End the description with the model
and harness that performed the work. For a fully human-authored change, use
`Model/harness: human-authored.` Do not claim a test, review, or tool run that
did not happen.

For changes to synchronization, adapters, permissions, authentication, or
protocols, make the relevant safety behavior explicit in the description. A
reviewer should be able to tell whether the change can cause data loss, alter
native bookmark mappings, change retry/recovery behavior, or require clients to
upgrade.

### Evidence and verification

Use the smallest proof that demonstrates the change works. At minimum:

- Behavioral code changes include focused tests for the changed behavior.
- Sync and conflict changes include fixtures for the relevant event ordering,
  offline, retry, or recovery case.
- Browser adapter changes include the supported-browser build/test and, where
  needed, a real-browser round trip covering the native API behavior.
- Protocol or service changes include contract validation and focused
  integration coverage.
- Documentation-only changes include link and formatting checks when available.

Do not replace meaningful behavior tests with assertions that merely mirror the
implementation. Record the exact targeted commands and their results in the PR
body. Let CI own broad repository-wide checks unless a maintainer asks for a
local full-suite run. GitHub Actions runs typecheck, unit tests, browser smoke,
and unsigned packaging on every pull request and push to `main`. Signed Firefox
packages are produced only when a GitHub release is published. See
[CI and releases](docs/ci.md).

UI changes must include before/after screenshots that make the changed state
clear. Animation, interaction, or timing changes must include a short video.
Upload this evidence directly to GitHub; never commit it as PR-only repository
content. Remove private bookmark data, credentials, tokens, and unrelated
profile information before uploading any evidence.

### Review and updates

Before requesting review:

- Read the complete diff, including generated or deleted files.
- Confirm the title, body, tests, and evidence describe the current branch.
- Check browser permissions, data retention, privacy, and backwards
  compatibility for the affected surface.
- Call out anything not tested or any follow-up that is intentionally out of
  scope.

During review:

- Keep discussion tied to the pull request's single concern.
- Fix valid findings and explain decisions that remain unchanged.
- Verify automated findings against the source before changing code.
- Dismiss false positives only with a written reason.
- Update the PR body when scope or verification changes.
- Do not add an unrelated fix just because the branch is already open.

Do not rewrite `main` or another shared branch. Rebasing a personal review
branch is acceptable when it helps keep the change current; if history has
already been shared, use `--force-with-lease` and tell reviewers that the commit
IDs changed.

### Merge and follow-through

Merge only after the required review and checks are green, the PR title is
conventional, and the description accurately records the final change. Unless
the repository is configured otherwise, prefer squash-merging one focused PR
into `main`; preserve the PR title as the resulting commit subject.

After merge, update or close the canonical tracking issue and delete the topic
branch when it is no longer needed. The merged PR is the implementation record;
do not maintain a second, stale checklist in the repository.

## Quick checklists

### Commit

- [ ] One logical change
- [ ] Conventional title with a useful type and optional scope
- [ ] Plain-language, lowercase subject after the colon
- [ ] Subject states the outcome and has no trailing period
- [ ] Body added when context or a breaking change needs to be preserved
- [ ] No secrets, real user data, or PR-only evidence

### Pull request

- [ ] One concern and a focused diff
- [ ] Title can serve as the merge commit subject
- [ ] Problem/why comes before fix/what changed
- [ ] Targeted verification is listed with results
- [ ] UI has before/after images; motion/timing has a short video
- [ ] Risks, rollout, and out-of-scope work are clear
- [ ] Tracking issue or design context is linked when available
- [ ] Final line names the model and harness

## Reference

These rules are adapted from the public T3 Code repository's contributor
instructions and source-control guide:

- [T3 Code `AGENTS.md`](https://github.com/pingdotgg/t3code/blob/main/AGENTS.md)
- [T3 Code source-control guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/source-control.md)
- [T3 Code pull-request examples](https://github.com/pingdotgg/t3code/pulls)
- [T3 Code example PR: desktop fix](https://github.com/pingdotgg/t3code/pull/4454)

The most relevant T3 Code rules are: plain-language Conventional Commit titles;
problem-then-fix PR descriptions; before/after images for UI changes; a short
video for motion or timing changes; GitHub-hosted PR evidence; and one concern
per PR.
