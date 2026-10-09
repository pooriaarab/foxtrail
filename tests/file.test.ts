import { appendFileSync, existsSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StoreError } from "../src/errors.js";
import { generateKey } from "../src/keys.js";
import { Log } from "../src/log.js";
import { FileStore } from "../src/node.js";

const dir = () => mkdtempSync(join(tmpdir(), "foxtrail-"));

describe("FileStore", () => {
  it("F4: starts empty and creates the file with mode 0600", async () => {
    const path = join(dir(), "log.jsonl");
    const store = new FileStore(path);
    expect(await store.count()).toBe(0);
    expect(await store.last()).toBeUndefined();
    const log = new Log({ store, key: await generateKey() });
    await log.append({ actor: "a", kind: "k", data: 1 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(await new FileStore(path).count()).toBe(1);
    expect(await log.verify()).toMatchObject({ ok: true, count: 1 });
  });

  it("F1: two Logs on one file keep one chain", async () => {
    const path = join(dir(), "log.jsonl");
    const key = await generateKey();
    const a = new Log({ store: new FileStore(path), key });
    const b = new Log({ store: new FileStore(path), key });
    await Promise.all(Array.from({ length: 30 }, (_v, i) => (i % 2 ? a : b).append({ actor: "a", kind: "k", data: i })));
    expect(await a.verify()).toMatchObject({ ok: true, count: 30 });
  });

  it("F2: refuses a partial last line", async () => {
    const path = join(dir(), "log.jsonl");
    const store = new FileStore(path);
    const log = new Log({ store, key: await generateKey() });
    await log.append({ actor: "a", kind: "k", data: 1 });
    appendFileSync(path, '{"seq":1,"ts"');
    const before = readFileSync(path, "utf8");
    await expect(log.append({ actor: "a", kind: "k", data: 2 })).rejects.toThrow(StoreError);
    await expect(store.all()).rejects.toThrow(StoreError);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("F3: stores an entry larger than the read chunk", async () => {
    const path = join(dir(), "log.jsonl");
    const store = new FileStore(path);
    const log = new Log({ store, key: await generateKey() });
    await log.append({ actor: "a", kind: "k", data: 1 });
    await log.append({ actor: "a", kind: "k", data: "x".repeat(900_000) });
    expect((await store.last())?.seq).toBe(1);
    await log.append({ actor: "a", kind: "k", data: 3 });
    expect(await log.verify()).toMatchObject({ ok: true, count: 3 });
  });

  it("F5: removes an old lock file", async () => {
    const path = join(dir(), "log.jsonl");
    writeFileSync(`${path}.lock`, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${path}.lock`, old, old);
    const log = new Log({ store: new FileStore(path), key: await generateKey() });
    await log.append({ actor: "a", kind: "k", data: 1 });
    expect(await log.verify()).toMatchObject({ ok: true });
  });

  it("F6: times out on a fresh lock file", async () => {
    const path = join(dir(), "log.jsonl");
    writeFileSync(`${path}.lock`, "");
    const log = new Log({ store: new FileStore(path, { lockTimeoutMs: 200 }), key: await generateKey() });
    await expect(log.append({ actor: "a", kind: "k", data: 1 })).rejects.toThrow(StoreError);
  });

  it("F10: leaves a lock that another writer now holds", async () => {
    const path = join(dir(), "log.jsonl");
    const store = new FileStore(path, { beforeRelease: async () => writeFileSync(`${path}.lock`, "someone-else") });
    const log = new Log({ store, key: await generateKey() });
    await log.append({ actor: "a", kind: "k", data: 1 });
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("someone-else");
  });

  it("F11: one writer takes a stale lock", async () => {
    const path = join(dir(), "log.jsonl");
    writeFileSync(`${path}.lock`, "dead-process");
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${path}.lock`, old, old);
    const key = await generateKey();
    const logs = Array.from({ length: 4 }, () => new Log({ store: new FileStore(path), key }));
    await Promise.all(Array.from({ length: 24 }, (_v, i) => (logs[i % 4] as Log).append({ actor: "a", kind: "k", data: i })));
    expect(await (logs[0] as Log).verify()).toMatchObject({ ok: true, count: 24 });
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("F12: refuses to report success after another entry landed", async () => {
    const path = join(dir(), "log.jsonl");
    const store = new FileStore(path, { beforeRelease: async () => appendFileSync(path, '{"rival":1}\n') });
    const log = new Log({ store, key: await generateKey() });
    await expect(log.append({ actor: "a", kind: "k", data: 1 })).rejects.toThrow(StoreError);
  });
});
