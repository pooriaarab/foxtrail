import { canonicalize } from "../src/canonical.js";
import { hmacHex, sha256Hex } from "../src/crypto.js";
import { generateKey } from "../src/keys.js";
import { Log } from "../src/log.js";
import { MemoryStore } from "../src/memory.js";
import type { Entry } from "../src/types.js";

export const now = () => {
  let t = 1_000;
  return () => (t += 10);
};

export async function build(n = 5) {
  const key = await generateKey();
  const store = new MemoryStore();
  const log = new Log({ store, key, now: now() });
  for (let i = 0; i < n; i++) await log.append({ actor: "agent", kind: "tool.call", data: { i, text: "caf\u00e9" } });
  return { key, store, log, entries: await log.entries() };
}

export const at = (list: Entry[], i: number) => list[i] as Entry;
export const clone = (entries: Entry[]) => structuredClone(entries);

/** Seal a body the way the library does, for tests that forge entries. */
export async function seal(key: CryptoKey, body: Omit<Entry, "hash" | "mac">): Promise<Entry> {
  const hash = await sha256Hex(canonicalize(body));
  return { ...body, hash, mac: await hmacHex(key, `foxtrail/entry/v1\n${hash}`) };
}

