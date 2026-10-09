import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { bytesToHex } from "./crypto.js";
import { KeyError } from "./errors.js";
import { importKey } from "./keys.js";

/**
 * Load the log key. A path gives a file with the key as hex. With no path,
 * the FOXTRAIL_KEY variable gives the hex. The key is not extractable.
 */
export async function loadKey(path?: string, env: Record<string, string | undefined> = process.env): Promise<CryptoKey> {
  if (path) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      throw new KeyError(`Cannot read the key file ${path}.`);
    }
    return importKey(text);
  }
  if (env.FOXTRAIL_KEY) return importKey(env.FOXTRAIL_KEY);
  throw new KeyError("No key. Give a key file, or set FOXTRAIL_KEY.");
}

/** Read the key file, or make it with 32 random bytes and mode 0600. */
export async function loadOrCreateKeyFile(path: string): Promise<CryptoKey> {
  try {
    await writeFile(path, `${bytesToHex(randomBytes(32))}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return loadKey(path);
}
