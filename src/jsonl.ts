import type { Entry } from "./types.js";

const ORDER = ["seq", "ts", "actor", "kind", "data", "prev", "hash", "mac"] as const;

/** One entry per line, fields in a fixed order, every line ends with a newline. */
export function exportJsonl(entries: readonly Entry[]): string {
  return entries.map((e) => `${JSON.stringify(Object.fromEntries(ORDER.map((k) => [k, e[k]])))}\n`).join("");
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
  }
  return { ok: true, entries };
}
