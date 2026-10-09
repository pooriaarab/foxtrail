import { describe, expect, it } from "vitest";
import { InvalidEntryError } from "../src/errors.js";
import { generateKey } from "../src/keys.js";
import { Log } from "../src/log.js";
import { MemoryStore } from "../src/memory.js";
import type { Entry } from "../src/types.js";
import { checkRedacted, secret } from "../src/redact.js";

const at = (e: Entry | undefined) => e as Entry;
const TOKEN = "sk-live-123456";

async function logWith(redact?: string[]) {
  const store = new MemoryStore();
  const log = new Log({ store, key: await generateKey(), redact });
  return { store, log };
}

describe("redaction", () => {
  it("R1: replaces secret() values at any depth", async () => {
    const { log, store } = await logWith();
    await log.append({ actor: "a", kind: "k", data: { auth: secret(TOKEN), list: [1, { deep: secret(TOKEN) }] } });
    const text = JSON.stringify(await store.all());
    expect(text).not.toContain(TOKEN);
    expect(text).toContain('"$redacted"');
  });

  it("R2: replaces listed keys at any depth", async () => {
    const { log, store } = await logWith(["password", "apiKey"]);
    await log.append({ actor: "a", kind: "k", data: { password: TOKEN, nested: [{ apiKey: { x: TOKEN } }], safe: "ok" } });
    const [entry] = await store.all();
    expect(JSON.stringify(entry)).not.toContain(TOKEN);
    expect((at(entry).data as { safe: string }).safe).toBe("ok");
  });

  it("R3: gives equal secrets different markers", async () => {
    const { log } = await logWith();
    const a = await log.append({ actor: "a", kind: "k", data: { t: secret(TOKEN) } });
    const b = await log.append({ actor: "a", kind: "k", data: { t: secret(TOKEN) } });
    expect(a.data).not.toEqual(b.data);
  });

  it("R4: checks a candidate against a marker", async () => {
    const { log } = await logWith();
    const entry = await log.append({ actor: "a", kind: "k", data: { t: secret({ token: TOKEN }) } });
    const marker = (entry.data as { t: unknown }).t;
    expect(await checkRedacted(marker, { token: TOKEN })).toBe(true);
    expect(await checkRedacted(marker, { token: "other" })).toBe(false);
    expect(await checkRedacted({ $redacted: "nope" }, TOKEN)).toBe(false);
    expect(await checkRedacted("text", TOKEN)).toBe(false);
  });

  it("R5: rejects a secret that is not JSON, and cyclic data", async () => {
    const { log, store } = await logWith(["k"]);
    await expect(log.append({ actor: "a", kind: "k", data: { t: secret(1n) } })).rejects.toThrow(InvalidEntryError);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    await expect(log.append({ actor: "a", kind: "k", data: loop })).rejects.toThrow(InvalidEntryError);
    expect(await store.count()).toBe(0);
  });

  it("R6: verifies a redacted log", async () => {
    const { log } = await logWith(["password"]);
    await log.append({ actor: "a", kind: "k", data: { password: TOKEN, t: secret(TOKEN) } });
    expect(await log.verify()).toMatchObject({ ok: true, count: 1 });
  });
});
