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

## Redaction

A secret becomes `{"$redacted":"<salt>:<sha256>"}` before the entry is hashed.
The salt is 16 random bytes. The hash covers the salt and the canonical JSON of
the value.

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| R1 | A `secret()` value sits in an object or an array, at any depth. | The stored entry holds the marker. The raw text is nowhere in the log. | `tests/redact.test.ts` |
| R2 | A key listed in the `redact` option holds a value at any depth. | Same as R1. | `tests/redact.test.ts` |
| R3 | The same secret is logged twice. | The two markers differ, so equal secrets do not match. | `tests/redact.test.ts` |
| R4 | `checkRedacted()` gets the right value, a wrong value, or a bad marker. | `true`, `false`, `false`. | `tests/redact.test.ts` |
| R5 | A secret holds a value that is not JSON, or the data points to itself. | `InvalidEntryError`. The log is unchanged. | `tests/redact.test.ts` |
| R6 | A redacted log is verified. | It verifies. | `tests/redact.test.ts` |

## JSONL export and import

One entry per line, fields in a fixed order, each line ends with `\n`.

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| J1 | A log is exported and parsed again. | The entries are equal and verify. | `tests/jsonl.test.ts` |
| J2 | A line is not valid JSON. | The parse result names the 1-based line. | `tests/jsonl.test.ts` |
| J3 | The text has a blank line in the middle. | The parse result names that line. One final `\n` is fine. Empty text is an empty log. | `tests/jsonl.test.ts` |
| J4 | A line is valid JSON but not an entry (`[1]`, `5`). | `verify()` reports `malformed` at that index. | `tests/jsonl.test.ts` |
| J5 | The file starts with a byte order mark, or uses `\r\n`. | Both parse and verify. | `tests/jsonl.test.ts` |
| J6 | `importJsonl()` gets a log that does not verify. | It throws. The store stays empty. | `tests/jsonl.test.ts` |
| J7 | `importJsonl()` runs on a store that has entries. | `ConflictError`. | `tests/jsonl.test.ts` |

## Node file store and key file

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| F1 | Two `Log` objects append to one file at the same time. | A lock file orders the writes. The chain verifies. | `tests/file.test.ts` |
| F2 | A crash leaves a last line with no newline. | `append()` and `all()` throw `StoreError`. The file stays as it is. | `tests/file.test.ts` |
| F3 | One entry is far larger than the read chunk. | It is stored, and `last()` reads it back. | `tests/file.test.ts` |
| F4 | The file does not exist yet. | The store is empty. The first append creates the file with mode 0600. | `tests/file.test.ts` |
| F5 | A lock file is old, because a process died. | The store removes it and goes on. | `tests/file.test.ts` |
| F6 | A lock file is fresh and stays. | `StoreError` after `lockTimeoutMs`. | `tests/file.test.ts` |
| F7 | A key file is made twice. | The second call reads the same key. The file has mode 0600. | `tests/keyfile.test.ts` |
| F8 | A key file holds bad text, or neither a file nor `FOXTRAIL_KEY` is given. | `KeyError`. | `tests/keyfile.test.ts` |
| F9 | `FOXTRAIL_KEY` holds the key and no file is given. | The key loads. | `tests/keyfile.test.ts` |

## The command line

`foxtrail verify <file.jsonl> [--key <file>] [--checkpoint <file>]`. Exit 0 when
the log is good, 1 when it is not, 2 when the command cannot run.

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| X1 | A good log. | Exit 0. Prints the entry count and head hash. | `tests/cli.test.ts` |
| X2 | One byte of an entry changes. | Exit 1. Prints the line number and the reason. | `tests/cli.test.ts` |
| X3 | No `--key` and no `FOXTRAIL_KEY`. | Exit 2. Never exit 0 without a key. | `tests/cli.test.ts` |
| X4 | The wrong key. | Exit 1 at line 1 with `bad-mac`. | `tests/cli.test.ts` |
| X5 | The log file does not exist. | Exit 2. | `tests/cli.test.ts` |
| X6 | No file, an unknown flag, or a flag with no value. | Exit 2 and a usage text. | `tests/cli.test.ts` |
| X7 | The tail is cut, with a checkpoint. | Exit 1 at the first missing line. | `tests/cli.test.ts` |
| X8 | The checkpoint file is not JSON, or is edited. | Exit 2 for bad JSON. Exit 1 for an edit. | `tests/cli.test.ts` |
| X9 | A line is not JSON. | Exit 1 with that line number. | `tests/cli.test.ts` |
| X10 | An empty log file. | Exit 0 with 0 entries. | `tests/cli.test.ts` |

## IndexedDB store and the demo extension

The browser rows are checked by the Firefox E2E test (`pnpm e2e`). The E2E test
loads the demo extension, uses its popup, exports the log, and runs the real
CLI on the export.

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| I1 | Two `Log` objects append to one `IdbStore` at the same time, like two tabs. | One chain. It verifies. | `e2e/run.mjs` check `race` |
| I2 | The popup closes and opens again. | The entries and the key are still there. The log verifies. | `e2e/run.mjs` check `reload` |
| I3 | Code tries to export a non-extractable key. | `KeyError`. | `e2e/run.mjs` check `non-extractable` |
| I4 | The store gets an entry with the wrong `seq`. | `ConflictError`. The count does not change. | `e2e/run.mjs` check `conflict` |
| I5 | The page has no IndexedDB. | `StoreError` from `IdbStore.open()`. | `tests/idb.test.ts` |
| E1 | The log that the popup exports goes to the CLI. | Exit 0. | `e2e/run.mjs` check `cli-good` |
| E2 | One byte of the export changes. | Exit 1. The message names the line. | `e2e/run.mjs` check `cli-tamper` |
| E3 | The export loses its last lines. | Exit 0 without a checkpoint. Exit 1 with one. | `e2e/run.mjs` check `cli-truncate` |
| E4 | The popup records a value marked secret. | The raw text is not in the export. | `e2e/run.mjs` check `redaction` |

## Review fixes: empty checkpoints

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| P5 | `verify()` gets a checkpoint that is `null`, `false`, `0`, `""`, an array or a number. | `bad-checkpoint`. Only `undefined` means no checkpoint. | `tests/checkpoint.test.ts` |
| P6 | A checkpoint file holds `null`, `false`, `0`, `""` or `[]`. | The CLI exits 2 and names the file. It never skips the check. | `tests/cli.test.ts` |
