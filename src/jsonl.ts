import type { Entry } from "./types.js";

const ORDER = ["seq", "ts", "actor", "kind", "data", "prev", "hash", "mac"] as const;

/** One entry per line, fields in a fixed order, every line ends with a newline. */
export function exportJsonl(entries: readonly Entry[]): string {
  return entries.map((e) => `${JSON.stringify(Object.fromEntries(ORDER.map((k) => [k, e[k]])))}\n`).join("");
}

/**
 * Find a key that an object repeats, at any depth. The text must be valid
 * JSON. Parsers disagree on which repeat wins, so foxtrail refuses them.
 */
function repeatedKey(text: string): string | undefined {
  const stack: (Set<string> | null)[] = [];
  let wantKey = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      stack.push(new Set());
      wantKey = true;
    } else if (c === "[") {
      stack.push(null);
    } else if (c === "}" || c === "]") {
      stack.pop();
      wantKey = false;
    } else if (c === ",") {
      wantKey = stack.at(-1) instanceof Set;
    } else if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const keys = stack.at(-1);
      if (wantKey && keys) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (keys.has(key)) return key;
        keys.add(key);
        wantKey = false;
      }
      i = j;
    }
  }
  return undefined;
}

export type ParseResult = { ok: true; entries: Entry[] } | { ok: false; line: number; message: string };

/**
 * Parse JSONL text. This checks only that each line is JSON: `verify()` checks
 * that each line is an entry. A byte order mark and `\r\n` are accepted.
 */
export function parseJsonl(text: string): ParseResult {
  const lines = text.replace(/^﻿/, "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const entries: Entry[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.trim() === "") return { ok: false, line: i + 1, message: `Line ${i + 1} is blank.` };
    try {
      entries.push(JSON.parse(line) as Entry);
    } catch {
      return { ok: false, line: i + 1, message: `Line ${i + 1} is not valid JSON.` };
    }
    const repeat = repeatedKey(line);
    if (repeat !== undefined) return { ok: false, line: i + 1, message: `Line ${i + 1} repeats the key ${JSON.stringify(repeat)}.` };
  }
  return { ok: true, entries };
}
