import { describe, expect, it } from "vitest";
import { ConflictError, InvalidEntryError } from "../src/errors.js";
import { exportJsonl, parseJsonl } from "../src/jsonl.js";
import { Log } from "../src/log.js";
import { MemoryStore } from "../src/memory.js";
import { verify } from "../src/verify.js";
import { build } from "./helpers.js";

describe("JSONL", () => {
  it("J1: round-trips and verifies", async () => {
    const { key, entries } = await build();
    const text = exportJsonl(entries);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.split("\n")).toHaveLength(6);
    const parsed = parseJsonl(text);
    expect(parsed).toEqual({ ok: true, entries });
    expect(await verify(entries, { key })).toMatchObject({ ok: true });
  });

  it("J2: names the line of bad JSON", async () => {
    const { entries } = await build(3);
    const lines = exportJsonl(entries).split("\n");
    lines[1] = `${lines[1]?.slice(0, 20)}`;
    expect(parseJsonl(lines.join("\n"))).toMatchObject({ ok: false, line: 2 });
  });

  it("J3: names a blank line and accepts an empty log", () => {
    expect(parseJsonl('{"a":1}\n\n{"a":2}\n')).toMatchObject({ ok: false, line: 2 });
    expect(parseJsonl("")).toEqual({ ok: true, entries: [] });
    expect(parseJsonl("\n")).toMatchObject({ ok: false, line: 1 });
  });

  it("J4: leaves a non-entry line to verify()", async () => {
    const { key, entries } = await build(2);
    const text = `${exportJsonl(entries)}[1]\n`;
    const parsed = parseJsonl(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(await verify(parsed.entries, { key })).toMatchObject({ ok: false, index: 2, reason: "malformed" });
  });

  it("J5: accepts a byte order mark and CRLF", async () => {
    const { key, entries } = await build(3);
    const text = `﻿${exportJsonl(entries).replaceAll("\n", "\r\n")}`;
    const parsed = parseJsonl(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(await verify(parsed.entries, { key })).toMatchObject({ ok: true, count: 3 });
  });

  it("J6: refuses to import a log that does not verify", async () => {
    const { key, entries } = await build(3);
    const bad = exportJsonl(entries).replace('"i":1', '"i":9');
    const store = new MemoryStore();
    await expect(new Log({ store, key }).importJsonl(bad)).rejects.toThrow(InvalidEntryError);
    expect(await store.count()).toBe(0);
  });

  it("imports a good log", async () => {
    const { key, entries } = await build(3);
    const store = new MemoryStore();
    expect(await new Log({ store, key }).importJsonl(exportJsonl(entries))).toBe(3);
    expect(await store.all()).toEqual(entries);
  });

  it("J7: refuses to import into a store that has entries", async () => {
    const { entries, log } = await build(1);
    await expect(log.importJsonl(exportJsonl(entries))).rejects.toThrow(ConflictError);
  });

  it("J8: rejects a repeated key at any depth", async () => {
    const { entries } = await build(2);
    const line = exportJsonl(entries).split("\n")[1] as string;
    const forged = line.replace('"actor":"agent"', '"actor":"agent","actor":"intruder"');
    expect(forged).not.toBe(line);
    expect(parseJsonl(`${line}\n${forged}\n`)).toMatchObject({ ok: false, line: 2 });
    expect(parseJsonl('{"data":{"a":1,"b":{"c":1,"c":2}}}\n')).toMatchObject({ ok: false, line: 1 });
  });

  it("J9: finds an escaped repeat and ignores key names inside strings", () => {
    expect(parseJsonl('{"a":1,"\\u0061":2}\n')).toMatchObject({ ok: false, line: 1 });
    expect(parseJsonl('{"a":"\\"a\\":1","b":[{"a":1},{"a":2}]}\n')).toMatchObject({ ok: true });
  });
});
