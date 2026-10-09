import { bytesToHex, hexToBytes } from "./crypto.js";
import { KeyError } from "./errors.js";

/** A CryptoKey, raw key bytes, or the key as a hex string. */
export type Key = CryptoKey | Uint8Array | string;

const MIN_BYTES = 32;
const USAGES: KeyUsage[] = ["sign", "verify"];

/**
 * Make a new HMAC-SHA-256 key. The key is non-extractable by default, so
 * code cannot read its bytes. Set `extractable` when an outside tool, such as
 * the foxtrail CLI, must verify the log.
 */
export function generateKey(options: { extractable?: boolean } = {}): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, options.extractable ?? false, USAGES);
}

/** Import raw key bytes or a hex string as a non-extractable HMAC key. */
export async function importKey(raw: Uint8Array | string): Promise<CryptoKey> {
  const bytes = typeof raw === "string" ? hexToBytes(raw.trim()) : new Uint8Array(raw);
  if (!bytes) throw new KeyError("The key is not valid hex.");
  if (bytes.length < MIN_BYTES) throw new KeyError(`The key has ${bytes.length} bytes. It needs at least ${MIN_BYTES}.`);
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, USAGES);
}

/** Export an extractable key as hex. A non-extractable key throws KeyError. */
export async function exportKeyHex(key: CryptoKey): Promise<string> {
  if (!key.extractable) throw new KeyError("The key is not extractable.");
  return bytesToHex(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

/** Turn any accepted key form into a usable CryptoKey, or throw KeyError. */
export async function resolveKey(key: Key | undefined): Promise<CryptoKey> {
  if (key === undefined || key === null || key === "") throw new KeyError("The key is missing.");
  if (typeof key === "string" || key instanceof Uint8Array) return importKey(key);
  const algorithm = key.algorithm as { name?: string; hash?: { name?: string } };
  const usable = algorithm.name === "HMAC" && key.usages.includes("sign") && key.usages.includes("verify");
  if (!usable) throw new KeyError("The key must be an HMAC key with the sign and verify usages.");
  return key;
}
