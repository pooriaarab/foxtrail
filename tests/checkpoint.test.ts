import { describe, expect, it } from "vitest";
import { GENESIS } from "../src/constants.js";
import { generateKey } from "../src/keys.js";
import { Log } from "../src/log.js";
import { MemoryStore } from "../src/memory.js";
import { verify } from "../src/verify.js";
import { build, now } from "./helpers.js";

describe("checkpoints", () => {
  it("P1: finds a cut tail only with a checkpoint", async () => {
    const { key, log, entries } = await build();
    const checkpoint = await log.checkpoint();
    expect(checkpoint.count).toBe(5);
    expect(await verify(entries.slice(0, 3), { key })).toMatchObject({ ok: true, count: 3 });
    expect(await verify(entries.slice(0, 3), { key, checkpoint })).toMatchObject({ ok: false, index: 3, reason: "truncated" });
    expect(await verify([], { key, checkpoint })).toMatchObject({ ok: false, index: 0, reason: "truncated" });
  });

  it("P2: rejects a checkpoint from another log", async () => {
    const a = await build();
    const b = await build();
    const checkpoint = await a.log.checkpoint();
    expect(await verify(b.entries, { key: a.key, checkpoint })).toMatchObject({ ok: false, index: 0, reason: "bad-mac" });
    // Same key, different history: the head differs.
    const store = new MemoryStore();
    const other = new Log({ store, key: a.key, now: now() });
    for (let i = 0; i < 5; i++) await other.append({ actor: "x", kind: "k", data: i });
    expect(await verify(await other.entries(), { key: a.key, checkpoint })).toMatchObject({ ok: false, index: 4, reason: "checkpoint-mismatch" });
  });

  it("P3: rejects an edited or foreign checkpoint", async () => {
    const { key, log, entries } = await build();
    const checkpoint = await log.checkpoint();
    expect(await verify(entries, { key, checkpoint: { ...checkpoint, count: 2 } })).toMatchObject({ ok: false, index: null, reason: "bad-checkpoint" });
    const foreign = await new Log({ store: new MemoryStore(), key: await generateKey() }).checkpoint();
    expect(await verify(entries, { key, checkpoint: foreign })).toMatchObject({ ok: false, reason: "bad-checkpoint" });
  });

  it("P4: a checkpoint stays valid when the log grows", async () => {
    const { key, log } = await build(2);
    const checkpoint = await log.checkpoint();
    await log.append({ actor: "a", kind: "k", data: 1 });
    expect(await log.verify({ checkpoint })).toMatchObject({ ok: true, count: 3 });
    const empty = new Log({ store: new MemoryStore(), key });
    expect(await empty.checkpoint()).toMatchObject({ count: 0, head: GENESIS });
  });
});
