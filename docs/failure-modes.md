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
