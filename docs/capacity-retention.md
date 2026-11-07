# Collection capacity and retention

The v0.1 snapshot remains bounded to 2,000 records and 600,000 UTF-8 JSON bytes
(with headroom below Convex's document limit). Ten active browsers may connect.
This is a small-collection release; larger live collections require a paginated
node store and protocol, rather than increasing the single-document limit.
Non-ASCII content counts by encoded bytes, not JavaScript string length.

Every push atomically moves deleted records into `retiredNodes`, an indexed,
identity-only deletion fence scoped to the collection. Existing full tombstones
are migrated lazily on the next push, including an empty push. Full deleted
payloads no longer consume snapshot capacity. Clients receive a full snapshot,
so absence removes the corresponding native bookmark without requiring history.
A new bookmark must use a fresh identity. Legacy explicit restore operations
cannot revive a retired identity; recovery must create a new identity.

Deletion fences do **not** expire. There is no safe finite offline window for
existing clients. All operations targeting a retired identity drain as conflicts,
including delayed creates, legacy restores, updates, and repeated deletes. No
checkpoint, device expiry, history row, or clock is needed to enforce this rule.
Folder deletion fences every descendant. A late new child of a retired folder
is redirected to Other by the existing missing-parent rule.

Operation history expires after 30 days; server backups expire after seven days.
An hourly internal cron removes bounded batches and schedules continuation for
backlogs. The backup endpoint retains up to ten recent backups per collection
(older legacy backlogs additionally drain through age expiry). Expiry is eventual,
not an exact deletion deadline. Installation sequence high-water marks survive
history expiry and acknowledge retried accepted sequences without reapplying them.
Clients must never reuse a sequence for new work, as already required by the
ordered outbox protocol. Recent history can retain losing edits; after expiry,
server history is no longer a recovery source. Local recovery/export remains
separate from server retention.

The permanent fence table grows with the number of distinct deleted identities,
but stores no bookmark titles or URLs. Devices and their sequence receipts also
remain stored, including revoked devices. Removing either independently would
weaken replay protection. Account deletion must delete `retiredNodes` along with
all other collection data; any explicit table list in account lifecycle work
must include it. The operator clear-all implementation enumerates schema tables.

Deploy schema/index changes and the cron with the backend. No production data
mutation or deployment is performed by this change. Rollback must preserve the
fence check: older backend code cannot safely accept writes after compaction.
A future paginated store must preserve these identity fences or introduce an
explicit, enforced protocol epoch before removing them.
