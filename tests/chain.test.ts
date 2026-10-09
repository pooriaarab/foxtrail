import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/canonical.js";
import { GENESIS } from "../src/constants.js";
import { sha256Hex } from "../src/crypto.js";
import { ConflictError, EntryTooLargeError, InvalidEntryError, KeyError } from "../src/errors.js";
import { generateKey } from "../src/keys.js";
import { Log } from "../src/log.js";
import { MemoryStore } from "../src/memory.js";
import type { Entry } from "../src/types.js";
import { verify } from "../src/verify.js";
import { at, build, clone, seal } from "./helpers.js";

describe("verify", () => {
  it("accepts an untouched log", async () => {
    const { key, entries } = await build();
    expect(await verify(entries, { key })).toMatchObject({ ok: true, count: 5, head: entries[4]?.hash });
    expect(entries[0]?.prev).toBe(GENESIS);
  });

  it("L1: finds an edited entry", async () => {
    const { key, entries } = await build();
    const bad = clone(entries);
    (at(bad, 2).data as { i: number }).i = 99;
    expect(await verify(bad, { key })).toMatchObject({ ok: false, index: 2, reason: "bad-hash" });
  });

  it("L2: finds a rewrite without the key", async () => {
    const { key, entries } = await build();
    const bad = clone(entries);
    (at(bad, 2).data as { i: number }).i = 99;
    for (let i = 2; i < bad.length; i++) {
      const e = bad[i] as Entry;
      if (i > 2) e.prev = (bad[i - 1] as Entry).hash;
      const { hash: _h, mac: _m, ...body } = e;
      e.hash = await sha256Hex(canonicalize(body));
    }
    expect(await verify(bad, { key })).toMatchObject({ ok: false, index: 2, reason: "bad-mac" });
  });

  it("L3: finds a deleted entry", async () => {
    const { key, entries } = await build();
    const bad = entries.filter((_e, i) => i !== 2);
    expect(await verify(bad, { key })).toMatchObject({ ok: false, index: 2, reason: "bad-sequence" });
  });

  it("L4: finds swapped and repeated entries", async () => {
    const { key, entries } = await build();
    const swapped = [entries[0], entries[2], entries[1], ...entries.slice(3)] as Entry[];
    expect(await verify(swapped, { key })).toMatchObject({ ok: false, index: 1, reason: "bad-sequence" });
    const repeated = [...entries.slice(0, 3), entries[2], ...entries.slice(3)] as Entry[];
    expect(await verify(repeated, { key })).toMatchObject({ ok: false, index: 3, reason: "bad-sequence" });
  });

  it("L8: reports bad-mac for the wrong key", async () => {
    const { entries } = await build();
    expect(await verify(entries, { key: await generateKey() })).toMatchObject({ ok: false, index: 0, reason: "bad-mac" });
  });

  it("L9: throws when the key is missing", async () => {
    const { entries } = await build();
    await expect(verify(entries, { key: undefined as never })).rejects.toThrow(KeyError);
  });

  it("L22: finds a wrong prev with the right seq", async () => {
    const key = await generateKey();
    const first = await seal(key, { seq: 0, ts: 1, actor: "a", kind: "k", data: 1, prev: GENESIS });
    const second = await seal(key, { seq: 1, ts: 2, actor: "a", kind: "k", data: 2, prev: GENESIS });
    expect(await verify([first, second], { key })).toMatchObject({ ok: false, index: 1, reason: "bad-prev" });
  });

  it("L11: finds a ts that goes backwards", async () => {
    const key = await generateKey();
    const first = await seal(key, { seq: 0, ts: 500, actor: "a", kind: "k", data: 1, prev: GENESIS });
    const second = await seal(key, { seq: 1, ts: 400, actor: "a", kind: "k", data: 2, prev: first.hash });
    expect(await verify([first, second], { key })).toMatchObject({ ok: false, index: 1, reason: "bad-time" });
  });

  it("L15: finds an extra, missing or mistyped field", async () => {
    const { key, entries } = await build();
    const extra = clone(entries);
    Object.assign(extra[1] as Entry, { admin: true });
    expect(await verify(extra, { key })).toMatchObject({ ok: false, index: 1, reason: "malformed" });
    const missing = clone(entries);
    delete (missing[3] as Partial<Entry>).mac;
    expect(await verify(missing, { key })).toMatchObject({ ok: false, index: 3, reason: "malformed" });
    const typed = clone(entries);
    (typed[0] as { seq: unknown }).seq = "0";
    expect(await verify(typed, { key })).toMatchObject({ ok: false, index: 0, reason: "malformed" });
  });

  it("L16: finds NFC changed to NFD", async () => {
    const { key, entries } = await build();
    const bad = clone(entries);
    (at(bad, 1).data as { text: string }).text = "café";
    expect(await verify(bad, { key })).toMatchObject({ ok: false, index: 1, reason: "bad-hash" });
  });

  it("L17: accepts entries with keys in another order", async () => {
    const { key, entries } = await build();
    const reordered = entries.map((e) => Object.fromEntries(Object.entries(e).toReversed()) as unknown as Entry);
    expect(await verify(reordered, { key })).toMatchObject({ ok: true });
  });
});

describe("Log", () => {
  it("L10: never lets ts go backwards", async () => {
    const key = await generateKey();
    const times = [5_000, 4_000, 4_500, 6_000];
    const log = new Log({ store: new MemoryStore(), key, now: () => times.shift() ?? 0 });
    for (let i = 0; i < 3; i++) await log.append({ actor: "a", kind: "k", data: i });
    expect((await log.entries()).map((e) => e.ts)).toEqual([5_000, 5_000, 5_000]);
    expect(await log.verify()).toMatchObject({ ok: true });
  });

  it("L12: serializes many appends in one Log", async () => {
    const { log } = await build(0);
    await Promise.all(Array.from({ length: 50 }, (_v, i) => log.append({ actor: "a", kind: "k", data: i })));
    const entries = await log.entries();
    expect(entries.map((e) => e.seq)).toEqual(Array.from({ length: 50 }, (_v, i) => i));
    expect(await log.verify()).toMatchObject({ ok: true, count: 50 });
  });

  it("L13: two Logs on one store do not fork the chain", async () => {
    const key = await generateKey();
    const store = new MemoryStore();
    const a = new Log({ store, key });
    const b = new Log({ store, key });
    await Promise.all(Array.from({ length: 40 }, (_v, i) => (i % 2 ? a : b).append({ actor: "a", kind: "k", data: i })));
    expect(await a.verify()).toMatchObject({ ok: true, count: 40 });
  });

  it("L14: refuses an entry over maxEntryBytes", async () => {
    const key = await generateKey();
    const store = new MemoryStore();
    const log = new Log({ store, key, maxEntryBytes: 1_000_000 });
    await expect(log.append({ actor: "a", kind: "k", data: "x".repeat(2_000_000) })).rejects.toThrow(EntryTooLargeError);
    expect(await store.count()).toBe(0);
    await log.append({ actor: "a", kind: "k", data: "x".repeat(500_000) });
    expect(await store.count()).toBe(1);
  });

  it("L18: copies the entry on append", async () => {
    const { key, log, store } = await build(0);
    const data = { list: [1] };
    const entry = await log.append({ actor: "a", kind: "k", data });
    data.list.push(2);
    (entry.data as typeof data).list.push(3);
    expect((await store.all())[0]?.data).toEqual({ list: [1] });
    expect(await verify(await store.all(), { key })).toMatchObject({ ok: true });
  });

  it("L19: rejects bad input and keeps the log", async () => {
    const { log, store } = await build(1);
    await expect(log.append({ actor: "", kind: "k", data: 1 })).rejects.toThrow(InvalidEntryError);
    await expect(log.append({ actor: "a", kind: "k", data: { x: undefined } })).rejects.toThrow(InvalidEntryError);
    await expect(log.append({ actor: "a", kind: "k", data: 1n })).rejects.toThrow(InvalidEntryError);
    expect(await store.count()).toBe(1);
  });

});

describe("MemoryStore", () => {
  it("L20: refuses a wrong seq or prev", async () => {
    const { store, entries } = await build(2);
    const next = { ...(entries[1] as Entry), seq: 2 };
    await expect(store.append({ ...next, prev: GENESIS })).rejects.toThrow(ConflictError);
    await expect(store.append({ ...next, seq: 5 })).rejects.toThrow(ConflictError);
    expect(await store.count()).toBe(2);
  });
});
