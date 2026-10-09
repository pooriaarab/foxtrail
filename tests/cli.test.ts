import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { exportKeyHex, generateKey } from "../src/keys.js";
import { exportJsonl } from "../src/jsonl.js";
import { Log } from "../src/log.js";
import { MemoryStore } from "../src/memory.js";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "foxtrail-"));
  const key = await generateKey({ extractable: true });
  const log = new Log({ store: new MemoryStore(), key });
  for (let i = 0; i < 4; i++) await log.append({ actor: "agent", kind: "tool.call", data: { i } });
  const file = join(dir, "log.jsonl");
  const keyFile = join(dir, "key");
  const checkpointFile = join(dir, "checkpoint.json");
  writeFileSync(file, exportJsonl(await log.entries()));
  writeFileSync(keyFile, `${await exportKeyHex(key)}\n`);
  writeFileSync(checkpointFile, JSON.stringify(await log.checkpoint()));
  return { dir, file, keyFile, checkpointFile };
}

async function cli(args: string[], env: Record<string, string> = {}) {
  let out = "";
  let err = "";
  const code = await run(args, { out: (s) => (out += s), err: (s) => (err += s), env });
  return { code, out, err };
}

describe("foxtrail verify", () => {
  it("X1: exits 0 for a good log", async () => {
    const f = await fixture();
    const r = await cli(["verify", f.file, "--key", f.keyFile, "--checkpoint", f.checkpointFile]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^ok: 4 entries, head [0-9a-f]{64}\n$/);
  });

  it("X2: exits 1 and names the line of an edit", async () => {
    const f = await fixture();
    writeFileSync(f.file, readFileSync(f.file, "utf8").replace('"i":2', '"i":7'));
    const r = await cli(["verify", f.file, "--key", f.keyFile]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^line 3: bad-hash:/);
  });

  it("X3: exits 2 without a key", async () => {
    const f = await fixture();
    const r = await cli(["verify", f.file]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/key/i);
  });

  it("reads the key from FOXTRAIL_KEY", async () => {
    const f = await fixture();
    const r = await cli(["verify", f.file], { FOXTRAIL_KEY: readFileSync(f.keyFile, "utf8").trim() });
    expect(r.code).toBe(0);
  });

  it("X4: exits 1 for the wrong key", async () => {
    const f = await fixture();
    writeFileSync(f.keyFile, `${"ab".repeat(32)}\n`);
    const r = await cli(["verify", f.file, "--key", f.keyFile]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^line 1: bad-mac:/);
  });

  it("X5: exits 2 for a missing file", async () => {
    const f = await fixture();
    expect((await cli(["verify", join(f.dir, "none.jsonl"), "--key", f.keyFile])).code).toBe(2);
  });

  it("X6: exits 2 with usage for bad arguments", async () => {
    const f = await fixture();
    for (const args of [[], ["verify"], ["verify", f.file, "--nope"], ["verify", f.file, "--key"], ["frobnicate"]]) {
      const r = await cli(args);
      expect(r.code).toBe(2);
      expect(r.err).toContain("Usage: foxtrail verify");
    }
  });

  it("X7: exits 1 at the first missing line of a cut tail", async () => {
    const f = await fixture();
    writeFileSync(f.file, readFileSync(f.file, "utf8").split("\n").slice(0, 2).join("\n") + "\n");
    const r = await cli(["verify", f.file, "--key", f.keyFile, "--checkpoint", f.checkpointFile]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^line 3: truncated:/);
  });

  it("X8: separates a bad checkpoint file from an edited one", async () => {
    const f = await fixture();
    const good = readFileSync(f.checkpointFile, "utf8");
    writeFileSync(f.checkpointFile, "{nope");
    expect((await cli(["verify", f.file, "--key", f.keyFile, "--checkpoint", f.checkpointFile])).code).toBe(2);
    writeFileSync(f.checkpointFile, good.replace('"count":4', '"count":3'));
    const r = await cli(["verify", f.file, "--key", f.keyFile, "--checkpoint", f.checkpointFile]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^checkpoint: bad-checkpoint:/);
  });

  it("X9: exits 1 with the line of bad JSON", async () => {
    const f = await fixture();
    writeFileSync(f.file, `${readFileSync(f.file, "utf8")}{oops\n`);
    const r = await cli(["verify", f.file, "--key", f.keyFile]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^line 5:/);
  });

  it("X10: accepts an empty log", async () => {
    const f = await fixture();
    writeFileSync(f.file, "");
    const r = await cli(["verify", f.file, "--key", f.keyFile]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("0 entries");
  });
});
