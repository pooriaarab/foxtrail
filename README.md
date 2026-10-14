# foxtrail

[![npm version](https://img.shields.io/npm/v/foxtrail)](https://www.npmjs.com/package/foxtrail)
[![Downloads/month](https://img.shields.io/npm/dm/foxtrail)](https://www.npmjs.com/package/foxtrail)
[![License: MIT](https://img.shields.io/npm/l/foxtrail)](https://github.com/pooriaarab/foxtrail/blob/main/LICENSE)
[![Zero runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-blue)](https://www.npmjs.com/package/foxtrail)

[Setup](#record-your-first-action) · [API reference](#runtime-surfaces) · [Comparisons](#compare) · [npm](https://www.npmjs.com/package/foxtrail)

foxtrail is an open-source tamper-evident audit log for AI agent actions in Node.js and browsers.
It chains entries with SHA-256 hashes and keyed authentication codes.
It exports JSON Lines (JSONL) logs and verifies their integrity with an API or CLI.

## Install

```bash
npm install foxtrail
```

Use Node.js 24 or later, or a browser with Web Crypto.
The package includes TypeScript declarations and has zero runtime dependencies.

## Record your first action

Save this code as `record.mjs` in a new directory. No environment variables are required.

```js
import { Log, secret } from "foxtrail";
import { FileStore, loadOrCreateKeyFile } from "foxtrail/node";

const key = await loadOrCreateKeyFile("agent.key");
const log = new Log({ store: new FileStore("agent.jsonl"), key });
await log.append({
  actor: "agent",
  kind: "tool.call",
  data: { tool: "login", token: secret("example-token") },
});
console.log((await log.verify()).ok); // true
```

```bash
node record.mjs
npx foxtrail verify agent.jsonl --key agent.key
```

Success prints `true`, then `ok: 1 entries, head <hash>` on the first run.
Keep `agent.key` private. Anyone with that key can forge entries.
`secret()` stores a salted hash instead of the token. Guessable values remain vulnerable to guessing.

## How it works

```text
Action -> redact selected data -> canonical JSON -> SHA-256 -> HMAC
                                      |
entry 0 hash -> entry 1 prev/hash -> entry 2 prev/hash -> ...
                                      |
                         signed checkpoint kept elsewhere
```

HMAC means hash-based message authentication code.
Verification checks sequence, previous hash, content hash, HMAC, and timestamp order.
A retained checkpoint detects a missing tail. There are nine verification failure reasons.

## Why it exists

Agent actions need an inspectable history with explicit integrity checks.
foxtrail keeps that history inside an application or a local file.
immudb supplies a database with cryptographic verification. Cossack Labs Acra protects audit logs for its security services.

## Compare

Checked on 2026-10-14 against [immudb's documentation](https://immudb.io/docs/immudb/)
and [Cossack Labs Acra's logging guide](https://docs.cossacklabs.com/acra/security-controls/security-logging-and-events/).

| Scope | foxtrail | immudb | Cossack Labs Acra |
|---|---|---|---|
| Main surface | Application audit-log library | Database with cryptographic verification | Data-security services with protected audit logs |
| Log data | Application-supplied actions | Stored database history | Acra service security and access events |
| Verification entry | JavaScript API or foxtrail CLI | Database proof and verification APIs | acra-log-verifier utility |

## Coverage

| Integration or store | Status | Scope |
|---|---|---|
| Node.js / FileStore | ✓ | JSONL file and verify CLI |
| IndexedDB / IdbStore | ✓ | Browser entries and stored keys |
| MemoryStore | ✓ | Process-local entries |
| Mozilla Firefox | ✓ | Demo extension and E2E runner |
| foxloop / foxgate | scaffold | Planned consumers; no adapters exported |

There are three store implementations and one CLI command.
The store and verification paths are source-checked. Local tests exercise their behavior.
No external-service credentials were checked. Planned fox consumers are not verified integrations.

## Common use cases

1. Node.js agent builders: log tool calls to JSONL and verify the exported history.
2. Firefox extension authors: retain browser actions and keys in IndexedDB.
3. CI maintainers: run `foxtrail verify` against a bot's log before accepting its output.
4. MCP client developers: explicitly append tool-call records from their own client code.
5. Security reviewers: retain checkpoints separately to detect a missing log tail.

## Features

- **Integrity checks:** verify hash links and keyed authentication through [the API or CLI](#runtime-surfaces).
- **Checkpoints:** sign log count and head hash with [log.checkpoint](#runtime-surfaces).
- **Selected-data redaction:** replace marked values or configured key names with [salted hashes](#runtime-surfaces).
- **JSONL transfer:** export logs and verify imports into empty stores with [Log](#runtime-surfaces).
- **Storage choice:** use [memory, IndexedDB, or files](#coverage).

## Runtime surfaces

```ts
import { Log, MemoryStore, IdbStore, idbKey, generateKey, importKey, exportKeyHex,
         verify, secret, checkRedacted, exportJsonl, parseJsonl } from "foxtrail";
import { FileStore, loadKey, loadOrCreateKeyFile } from "foxtrail/node";
```

| Name | What it does |
|---|---|
| `new Log({ store, key, now?, maxEntryBytes?, redact? })` | Opens a log. `key` is a `CryptoKey`, raw bytes, or a hex string of at least 32 bytes. `redact` lists key names to hash at any depth. |
| `log.append({ actor, kind, data? })` | Adds one entry and returns it. Calls run one at a time. A stale write retries. `ts` never goes down. |
| `log.verify({ checkpoint? })` | Returns `{ ok: true, count, head }` or `{ ok: false, index, reason, message }`. |
| `log.checkpoint()` | Returns a signed `{ count, head, ts, mac }`. |
| `log.exportJsonl()` / `log.importJsonl(text)` | Moves a log as text. Import checks the log first and needs an empty store. |
| `verify(entries, { key, checkpoint? })` | The same check on a plain array. It throws `KeyError` when the key is missing. |
| `secret(value)` | Marks a value. The entry holds `{"$redacted":"<salt>:<sha256>"}`. |
| `checkRedacted(marker, candidate)` | True when `candidate` is the hidden value. |
| `generateKey({ extractable? })`, `importKey`, `exportKeyHex` | HMAC-SHA-256 keys. A key is non-extractable by default. |
| `MemoryStore`, `IdbStore.open(name)`, `FileStore(path)` | The three stores. `FileStore` is in `foxtrail/node`. |
| `idbKey(name, { extractable? })` | Keeps the key in IndexedDB. All tabs get the same key. |

An entry is `{ seq, ts, actor, kind, data, prev, hash, mac }`. `ts` is in milliseconds.

### CLI

```bash
foxtrail verify <file.jsonl> [--key <file>] [--checkpoint <file>]
```

The key file holds the key as hex. Without `--key`, the CLI reads `FOXTRAIL_KEY`.

| Exit code | Meaning |
|---|---|
| 0 | The log is good. |
| 1 | The log is bad. The first bad line is on stderr, for example `line 3: bad-hash: Entry 2 was edited…`. |
| 2 | The command cannot run: no key, no file, or a wrong option. |


The root entry also exports `canonicalize`, `GENESIS`, `Secret`, and six error classes.
`log.entries()` reads all stored entries. There is no Model Context Protocol (MCP) server.
## Delivery/behavior limits

- foxtrail is tamper-evident, not tamper-proof. A person with the key can rewrite the whole log.
- HMAC is a shared secret. Anyone who verifies a log can also forge one. Public-key signatures (Ed25519) are not built.
- A cut tail is visible only when you hold a checkpoint from before the cut. foxtrail does not store checkpoints for you.
- A non-extractable key cannot go to the CLI. Only code in the same browser can verify such a log.
- `ts` comes from the local clock. foxtrail keeps it from going down, but does not prove it is true.
- A redacted value is a salted SHA-256. A short or guessable secret can be guessed from the hash. `actor` and `kind` are never redacted.
- foxtrail does not normalize Unicode. A text change from NFC to NFD counts as an edit.
- `verify` reads the whole log into memory. There is no rotation or compaction.
- The file lock is a lock file with an owner token. A crashed process leaves it for 10 seconds before the next writer moves it away. A writer that loses its lock fails with `StoreError`.
- A JSONL line with a repeated key is refused, and a checkpoint file must hold an object.
- Whitespace and key order in a JSONL line are not signed. Only the values are.
- Only Firefox runs the browser E2E test. Other browsers are not verified here.

- Appends stop after 100 conflict attempts. The default canonical entry limit is 1 MiB.

## Integration guides

### Node.js files and CLI keys

Use `FileStore` and `loadOrCreateKeyFile` from `foxtrail/node` as shown in [the quickstart](#record-your-first-action).
Without `--key`, the CLI reads a hexadecimal key from `FOXTRAIL_KEY`.
The CLI does not load `.env` automatically. Use Node's `--env-file` when invoking the built CLI directly.
Protect environment files as carefully as key files.

### Firefox extension

Clone this public repository, run `pnpm install`, then `pnpm build:ext`.
Load `dist-ext/manifest.json` as a temporary add-on from `about:debugging`.
The popup records sample events, races two IndexedDB writers, verifies entries, and exports JSONL and a checkpoint.
Its key is extractable for CLI verification. The library's generated keys are non-extractable by default.

### Browser storage

Use `IdbStore.open(name)` and `idbKey(name)` in a bundled browser page.
Keep checkpoints outside the log store when tail-deletion detection matters.
Same-origin scripts can use stored browser keys even when their bytes are non-extractable.

## Status

Version 0.1.3 is an early release. APIs and entry formats can change before 1.0.
[Report issues on GitHub](https://github.com/pooriaarab/foxtrail/issues).
Public case studies are not yet published in this repository.

## FAQ

### What is foxtrail?

foxtrail records application-supplied agent actions in a keyed hash chain.
It verifies stored entries through JavaScript or the CLI.

### Which integrations are verified?

foxtrail implements FileStore, IdbStore, MemoryStore, and a Firefox demo.
This rewrite checks source and local tests; foxloop and foxgate consumers remain planned.

### Does foxtrail provide a managed audit service?

foxtrail runs in your application or browser.
It does not provide a managed collector or log-storage endpoint.

### How is foxtrail different from immudb?

foxtrail is an embedded audit-log library with three stores and a JSONL CLI.
immudb is a database with cryptographic proofs and verification.

### How is foxtrail different from Cossack Labs Acra?

foxtrail records actions supplied by application code.
Acra protects audit logs produced by its data-security services.

### Can someone with the key forge a log?

foxtrail uses a shared HMAC key for writing and verification.
Anyone with that key can create valid replacement entries.

### Can foxtrail detect a deleted final entry?

foxtrail detects a missing tail when verification receives an earlier retained checkpoint.
Store that checkpoint separately from the log.

### Does foxtrail automatically capture agent actions?

foxtrail records only the entries your application appends.
It provides no automatic browser-action or MCP interception adapter.

### Does foxtrail encrypt logged data?

foxtrail authenticates entries and hashes selected secret values.
It does not encrypt the whole log, and unmarked data remains readable.

## Testing

`pnpm ci:local` runs lint, typecheck, tests, builds, extension lint, and listing checks.
`pnpm e2e` records and exports entries in Firefox, verifies them with the CLI, then checks tamper detection.

## License

[MIT](https://github.com/pooriaarab/foxtrail/blob/main/LICENSE)
