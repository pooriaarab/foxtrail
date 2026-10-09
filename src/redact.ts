import { canonicalize } from "./canonical.js";
import { bytesToHex, sha256Hex } from "./crypto.js";
import { InvalidEntryError } from "./errors.js";

const MAX_DEPTH = 64;

/** Marks a value that the log must never store. Use `secret(value)`. */
export class Secret {
  readonly #value: unknown;
  constructor(value: unknown) {
    this.#value = value;
  }
  /** Replace the value with its salted hash. */
  async seal(): Promise<{ $redacted: string }> {
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    return { $redacted: `${salt}:${await sha256Hex(`${salt}:${canonicalize(this.#value)}`)}` };
  }
  toJSON(): never {
    throw new InvalidEntryError("A secret cannot be turned into JSON. Pass it to Log.append.");
  }
}

export const secret = (value: unknown): Secret => new Secret(value);

/**
 * Copy `data` with every Secret, and every value under a key in `names`,
 * replaced by a marker. Other values pass through unchanged.
 */
export async function redact(data: unknown, names: readonly string[], depth = 0): Promise<unknown> {
  if (depth > MAX_DEPTH) throw new InvalidEntryError(`The value nests deeper than ${MAX_DEPTH} levels.`);
  if (data instanceof Secret) return data.seal();
  if (Array.isArray(data)) return Promise.all(data.map((item) => redact(item, names, depth + 1)));
  if (typeof data !== "object" || data === null || (Object.getPrototypeOf(data) !== Object.prototype && Object.getPrototypeOf(data) !== null)) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = names.includes(key) ? await new Secret(value).seal() : await redact(value, names, depth + 1);
  }
  return out;
}

/** True when `candidate` is the value that a marker from this log hides. */
export async function checkRedacted(marker: unknown, candidate: unknown): Promise<boolean> {
  const text = (marker as { $redacted?: unknown } | null)?.$redacted;
  if (typeof text !== "string") return false;
  const [salt, hash] = text.split(":");
  if (!salt || !hash) return false;
  try {
    return (await sha256Hex(`${salt}:${canonicalize(candidate)}`)) === hash;
  } catch {
    return false;
  }
}
