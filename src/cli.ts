import { readFile } from "node:fs/promises";
import { FoxtrailError } from "./errors.js";
import { parseJsonl } from "./jsonl.js";
import { loadKey } from "./keyfile.js";
import type { Checkpoint } from "./types.js";
import { verify } from "./verify.js";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  env: Record<string, string | undefined>;
}

const USAGE = `Usage: foxtrail verify <file.jsonl> [--key <file>] [--checkpoint <file>]

Checks the hash chain and the MAC of every entry. Without --key it reads the
FOXTRAIL_KEY variable. Exit 0: the log is good. Exit 1: it is not, and the
first bad line is named. Exit 2: the command cannot run.
`;

class UsageError extends Error {}

function parseArgs(args: string[]): { file: string; key?: string; checkpoint?: string } {
  const [command, ...rest] = args;
  if (command !== "verify") throw new UsageError(command ? `Unknown command: ${command}` : "No command.");
  const options: { file?: string; key?: string; checkpoint?: string } = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (arg === "--key" || arg === "--checkpoint") {
      const value = rest[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a file.`);
      options[arg === "--key" ? "key" : "checkpoint"] = value;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (options.file === undefined) {
      options.file = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }
  if (options.file === undefined) throw new UsageError("No log file.");
  return options as { file: string; key?: string; checkpoint?: string };
}

/** Run the CLI. Returns the exit code. */
export async function run(args: string[], io: Io): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.out(USAGE);
    return 0;
  }
  try {
    const options = parseArgs(args);
    const key = await loadKey(options.key, io.env);
    const text = await readFile(options.file, "utf8").catch(() => {
      throw new Error(`Cannot read ${options.file}.`);
    });
    let checkpoint: Checkpoint | undefined;
    if (options.checkpoint) {
      const raw = await readFile(options.checkpoint, "utf8").catch(() => {
        throw new Error(`Cannot read ${options.checkpoint}.`);
      });
      try {
        checkpoint = JSON.parse(raw) as Checkpoint;
      } catch {
        throw new Error(`${options.checkpoint} is not JSON.`);
      }
    }
    const parsed = parseJsonl(text);
    if (!parsed.ok) {
      io.err(`line ${parsed.line}: ${parsed.message}\n`);
      return 1;
    }
    const result = await verify(parsed.entries, { key, checkpoint });
    if (result.ok) {
      io.out(`ok: ${result.count} entries, head ${result.head}\n`);
      return 0;
    }
    io.err(`${result.index === null ? "checkpoint" : `line ${result.index + 1}`}: ${result.reason}: ${result.message}\n`);
    return 1;
  } catch (error) {
    if (error instanceof UsageError) io.err(`${error.message}\n${USAGE}`);
    else if (error instanceof FoxtrailError || error instanceof Error) io.err(`${error.message}\n`);
    else throw error;
    return 2;
  }
}
