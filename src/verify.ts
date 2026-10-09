import { canonicalize } from "./canonical.js";
import { hmacVerify, sha256Hex } from "./crypto.js";
import { InvalidEntryError } from "./errors.js";
import { resolveKey, type Key } from "./keys.js";
import { CHECKPOINT_DOMAIN, ENTRY_DOMAIN, GENESIS } from "./constants.js";
import type { Checkpoint, Entry, VerifyReason, VerifyResult } from "./types.js";

const FIELDS = ["actor", "data", "hash", "kind", "mac", "prev", "seq", "ts"];
const HEX64 = /^[0-9a-f]{64}$/;
const isCount = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  return (
    Object.keys(e).toSorted().join() === FIELDS.join() &&
    isCount(e.seq) &&
    isCount(e.ts) &&
    typeof e.actor === "string" &&
    e.actor !== "" &&
    typeof e.kind === "string" &&
    e.kind !== "" &&
    [e.prev, e.hash, e.mac].every((v) => typeof v === "string" && HEX64.test(v))
  );
}

const fail = (index: number | null, reason: VerifyReason, message: string): VerifyResult => ({ ok: false, index, reason, message });

/**
 * Walk the chain from the first entry. Returns the first bad entry, or ok.
 * A checkpoint also detects a cut tail. The key is required: a hash chain
 * alone can be rebuilt by anyone with write access.
 */
export async function verify(entries: Entry[], options: { key: Key; checkpoint?: Checkpoint }): Promise<VerifyResult> {
  const key = await resolveKey(options.key);
  const { checkpoint } = options;
  if (checkpoint) {
    const { mac, ...body } = checkpoint;
    const shaped = isCount(body.count) && isCount(body.ts) && HEX64.test(String(body.head)) && typeof mac === "string";
    if (!shaped || !(await hmacVerify(key, mac, CHECKPOINT_DOMAIN + canonicalize({ count: body.count, head: body.head, ts: body.ts })))) {
      return fail(null, "bad-checkpoint", "The checkpoint is not signed by this key.");
    }
  }
  let prev = GENESIS;
  let prevTs = 0;
  for (const [i, entry] of entries.entries()) {
    if (!isEntry(entry)) return fail(i, "malformed", `Entry ${i} does not have the fields of an entry.`);
    if (entry.seq !== i) return fail(i, "bad-sequence", `Entry ${i} has seq ${entry.seq}. An entry is missing, moved or repeated.`);
    if (entry.prev !== prev) return fail(i, "bad-prev", `Entry ${i} does not point to the entry before it.`);
    const { hash, mac, ...body } = entry;
    let expected: string;
    try {
      expected = await sha256Hex(canonicalize(body));
    } catch (error) {
      if (error instanceof InvalidEntryError) return fail(i, "malformed", `Entry ${i} holds data that is not JSON.`);
      throw error;
    }
    if (expected !== hash) return fail(i, "bad-hash", `Entry ${i} was edited: its hash does not match its content.`);
    if (!(await hmacVerify(key, mac, ENTRY_DOMAIN + hash))) return fail(i, "bad-mac", `Entry ${i} has a bad MAC. The key is wrong or the entry was rewritten.`);
    if (entry.ts < prevTs) return fail(i, "bad-time", `Entry ${i} is older than the entry before it.`);
    prev = hash;
    prevTs = entry.ts;
  }
  if (checkpoint) {
    if (entries.length < checkpoint.count) {
      return fail(entries.length, "truncated", `The log has ${entries.length} entries. The checkpoint says ${checkpoint.count}.`);
    }
    const head = checkpoint.count === 0 ? GENESIS : (entries[checkpoint.count - 1] as Entry).hash;
    if (head !== checkpoint.head) return fail(Math.max(checkpoint.count - 1, 0), "checkpoint-mismatch", "The log does not match the checkpoint.");
  }
  return { ok: true, count: entries.length, head: prev };
}
