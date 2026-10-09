import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hmacHex, sha256Hex } from "../src/crypto.js";
import { KeyError } from "../src/errors.js";
import { exportKeyHex, generateKey, importKey, resolveKey } from "../src/keys.js";

const HEX32 = "ab".repeat(32);

describe("keys", () => {
  it("K1: rejects a missing key", async () => {
    await expect(resolveKey(undefined)).rejects.toThrow(KeyError);
    await expect(resolveKey("")).rejects.toThrow(KeyError);
  });

  it("K2: rejects a short key and bad hex", async () => {
    await expect(importKey("ab".repeat(31))).rejects.toThrow(KeyError);
    await expect(importKey(new Uint8Array(16))).rejects.toThrow(KeyError);
    await expect(importKey("zz".repeat(32))).rejects.toThrow(KeyError);
    await expect(importKey(`${HEX32}0`)).rejects.toThrow(KeyError);
  });

  it("K3: refuses to export a non-extractable key", async () => {
    const key = await generateKey();
    await expect(exportKeyHex(key)).rejects.toThrow(KeyError);
  });

  it("K4: rejects a CryptoKey that is not a usable HMAC key", async () => {
    const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    await expect(resolveKey(aes)).rejects.toThrow(KeyError);
    const signOnly = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await expect(resolveKey(signOnly)).rejects.toThrow(KeyError);
  });

  it("K5: a key survives export and import", async () => {
    const original = await generateKey({ extractable: true });
    const copy = await importKey(await exportKeyHex(original));
    expect(await hmacHex(copy, "hello")).toBe(await hmacHex(original, "hello"));
  });

  it("agrees with node:crypto", async () => {
    const key = await importKey(HEX32);
    expect(await hmacHex(key, "hello")).toBe(createHmac("sha256", Buffer.from(HEX32, "hex")).update("hello").digest("hex"));
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
