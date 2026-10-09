import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hmacHex } from "../src/crypto.js";
import { KeyError } from "../src/errors.js";
import { loadKey, loadOrCreateKeyFile } from "../src/node.js";

const dir = () => mkdtempSync(join(tmpdir(), "foxtrail-"));

describe("key file", () => {
  it("F7: makes a key once and reads it after", async () => {
    const path = join(dir(), "key");
    const first = await loadOrCreateKeyFile(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const second = await loadOrCreateKeyFile(path);
    expect(await hmacHex(second, "x")).toBe(await hmacHex(first, "x"));
  });

  it("F8: rejects bad text and a missing source", async () => {
    const path = join(dir(), "key");
    writeFileSync(path, "not hex\n");
    await expect(loadKey(path, {})).rejects.toThrow(KeyError);
    await expect(loadOrCreateKeyFile(path)).rejects.toThrow(KeyError);
    await expect(loadKey(undefined, {})).rejects.toThrow(KeyError);
    await expect(loadKey(join(dir(), "none"), {})).rejects.toThrow(KeyError);
  });

  it("F9: reads FOXTRAIL_KEY", async () => {
    const hex = "cd".repeat(32);
    const path = join(dir(), "key");
    writeFileSync(path, `${hex}\n`);
    const fromFile = await loadKey(path, {});
    const fromEnv = await loadKey(undefined, { FOXTRAIL_KEY: hex });
    expect(await hmacHex(fromEnv, "x")).toBe(await hmacHex(fromFile, "x"));
  });
});
