import { InvalidEntryError } from "./errors.js";

const MAX_DEPTH = 64;

/**
 * Turn a JSON value into one exact string: no spaces, keys sorted by UTF-16
 * code unit, strings escaped by JSON.stringify. The function never normalizes
 * text. It throws on anything that is not plain JSON, so no data is dropped.
 */
export function canonicalize(value: unknown): string {
  return write(value, 0, new Set());
}

function write(value: unknown, depth: number, seen: Set<object>): string {
  if (depth > MAX_DEPTH) throw new InvalidEntryError(`The value nests deeper than ${MAX_DEPTH} levels.`);
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new InvalidEntryError("A number must be finite.");
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new InvalidEntryError(`A ${typeof value} is not JSON.`);
  }
  const object = value as object;
  if (seen.has(object)) throw new InvalidEntryError("The value points to itself.");
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      const items: string[] = [];
      for (let i = 0; i < object.length; i++) items.push(write(object[i], depth + 1, seen));
      return `[${items.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) throw new InvalidEntryError("Only plain objects are JSON.");
    const record = object as Record<string, unknown>;
    const parts = Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${write(record[key], depth + 1, seen)}`);
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(object);
  }
}
