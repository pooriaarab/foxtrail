# Failure modes

Every way foxtrail can fail is listed here before the code exists. Each row has
a test. The test commit comes before the code commit in the git history.

The tests sit in `tests/`. The browser rows are checked by the E2E test in
`e2e/run.mjs`.

## Canonical JSON and keys

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| C1 | Two objects hold the same data in a different key order. | Both give the same canonical string. | `tests/canonical.test.ts` |
| C2 | A string has the same text in NFC and NFD form. | The two forms stay different. foxtrail never normalizes text. | `tests/canonical.test.ts` |
| C3 | A string holds a lone surrogate. | The canonical form escapes it, so it cannot collide with U+FFFD. | `tests/canonical.test.ts` |
| C4 | A value is not JSON: `undefined`, `NaN`, `Infinity`, `bigint`, a function, a `Date`, a `Map`. | `InvalidEntryError`. The value is never dropped or changed. | `tests/canonical.test.ts` |
| C5 | An object points to itself, or nests deeper than 64 levels. | `InvalidEntryError`. | `tests/canonical.test.ts` |
| C6 | A parsed object has an own key named `__proto__`. | The key stays in the canonical string. | `tests/canonical.test.ts` |
| K1 | No key is given. | `KeyError`. | `tests/keys.test.ts` |
| K2 | The key has fewer than 32 bytes, or is not valid hex. | `KeyError`. | `tests/keys.test.ts` |
| K3 | The code exports a non-extractable key. | `KeyError`. The key never leaves the browser. | `tests/keys.test.ts` |
| K4 | The key is a `CryptoKey` that is not HMAC or lacks sign and verify. | `KeyError`. | `tests/keys.test.ts` |
| K5 | A key is exported to hex and imported again. | Both keys give the same MAC. | `tests/keys.test.ts` |

## The hash chain and MAC

Each entry holds `seq`, `ts`, `actor`, `kind`, `data`, `prev`, `hash` and `mac`.
`hash` is SHA-256 over the canonical JSON of the first six fields. `mac` is
HMAC-SHA-256 of the hash. `verify()` reports the first bad entry by its
0-based index.

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| L1 | Someone edits the data of one entry. | `bad-hash` at that entry. | `tests/chain.test.ts` |
| L2 | Someone edits an entry and recomputes every hash after it, with no key. | `bad-mac` at the edited entry. | `tests/chain.test.ts` |
| L3 | Someone deletes an entry from the middle. | `bad-sequence` at the entry after the gap. | `tests/chain.test.ts` |
| L4 | Someone swaps two entries, or repeats one. | `bad-sequence` at the first moved entry. | `tests/chain.test.ts` |
| L8 | `verify()` gets the wrong key. | `bad-mac` at entry 0. | `tests/chain.test.ts` |
| L9 | `verify()` gets no key. | `KeyError`. It never reports success without a key. | `tests/chain.test.ts` |
| L10 | The clock goes backwards. | A new entry keeps the last `ts`. `ts` never decreases. | `tests/chain.test.ts` |
| L11 | An entry has a `ts` lower than the entry before it. | `bad-time`. | `tests/chain.test.ts` |
| L12 | Many appends run at the same time in one `Log`. | Every entry gets its own `seq`. The chain verifies. | `tests/chain.test.ts` |
| L13 | Two `Log` objects append to one store at the same time (two tabs). | The store refuses the stale write. The loser retries. The chain verifies. | `tests/chain.test.ts` |
| L14 | An entry is larger than `maxEntryBytes`. | `EntryTooLargeError`. The log is unchanged. | `tests/chain.test.ts` |
| L15 | An entry has an extra field, a missing field, or a wrong type. | `malformed` at that entry. | `tests/chain.test.ts` |
| L16 | Text is changed from NFC to NFD in a stored entry. | `bad-hash`. | `tests/chain.test.ts` |
| L17 | The keys of a stored entry are in another order. | The entry still verifies. | `tests/chain.test.ts` |
| L18 | Code changes an object after it appends it. | The stored entry does not change. | `tests/chain.test.ts` |
| L19 | The caller gives an empty actor or a `data` value that is not JSON. | `InvalidEntryError`. The log is unchanged. | `tests/chain.test.ts` |
| L20 | The store gets an entry with the wrong `seq` or `prev`. | `ConflictError`. | `tests/chain.test.ts` |
| L22 | An entry has the right `seq` but its `prev` is not the hash before it. | `bad-prev`. | `tests/chain.test.ts` |

## Checkpoints

A checkpoint holds `count`, `head`, `ts` and a `mac`. It is the only way to see a cut tail.

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| P1 | Someone cuts entries off the end. | Without a checkpoint nothing is wrong. With one, `truncated` at the first missing index. | `tests/checkpoint.test.ts` |
| P2 | A checkpoint from one log is used on another log. | `checkpoint-mismatch`. | `tests/checkpoint.test.ts` |
| P3 | A checkpoint is edited, or signed by another key. | `bad-checkpoint`. | `tests/checkpoint.test.ts` |
| P4 | The log grows after a checkpoint. | The checkpoint still verifies. | `tests/checkpoint.test.ts` |
