import { randomUUID } from "node:crypto";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { GENESIS } from "./constants.js";
import { ConflictError, StoreError } from "./errors.js";
import { parseJsonl } from "./jsonl.js";
import type { Entry, Store } from "./types.js";

const CHUNK = 64 * 1024;
const STALE_LOCK_MS = 10_000;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** A JSONL file that only grows. A lock file next to it orders writers. */
export class FileStore implements Store {
  readonly #path: string;
  readonly #timeout: number;
  readonly #beforeRelease?: () => Promise<void>;

  /** `beforeRelease` is a test hook. It runs after the write, while the lock is still held. */
  constructor(path: string, options: { lockTimeoutMs?: number; beforeRelease?: () => Promise<void> } = {}) {
    this.#path = path;
    this.#timeout = options.lockTimeoutMs ?? 5_000;
    this.#beforeRelease = options.beforeRelease;
  }

  async all(): Promise<Entry[]> {
    let text: string;
    try {
      text = await readFile(this.#path, "utf8");
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    if (text !== "" && !text.endsWith("\n")) throw new StoreError("The last line has no newline. A write was cut short.");
    const parsed = parseJsonl(text);
    if (!parsed.ok) throw new StoreError(parsed.message);
    return parsed.entries;
  }

  async count(): Promise<number> {
    const last = await this.last();
    return last ? last.seq + 1 : 0;
  }

  /** Reads the file from the end, so the cost does not grow with the log. */
  async last(): Promise<Entry | undefined> {
    let handle;
    try {
      handle = await open(this.#path, "r");
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
    try {
      const { size } = await handle.stat();
      if (size === 0) return undefined;
      const tail = Buffer.alloc(1);
      await handle.read(tail, 0, 1, size - 1);
      if (tail[0] !== 10) throw new StoreError("The last line has no newline. A write was cut short.");
      let start = size - 1;
      let bytes = Buffer.alloc(0);
      while (start > 0 && !bytes.includes(10)) {
        const n = Math.min(CHUNK, start);
        start -= n;
        const chunk = Buffer.alloc(n);
        await handle.read(chunk, 0, n, start);
        bytes = Buffer.concat([chunk, bytes]);
      }
      const line = bytes.subarray(bytes.lastIndexOf(10) + 1).toString("utf8");
      try {
        return JSON.parse(line) as Entry;
      } catch {
        throw new StoreError("The last line is not valid JSON.");
      }
    } finally {
      await handle.close();
    }
  }

  async append(entry: Entry): Promise<void> {
    const token = await this.#lock();
    try {
      const last = await this.last();
      if (entry.seq !== (last ? last.seq + 1 : 0) || entry.prev !== (last?.hash ?? GENESIS)) {
        throw new ConflictError(`Entry ${entry.seq} does not fit the file.`);
      }
      const handle = await open(this.#path, "a", 0o600);
      try {
        await handle.write(`${JSON.stringify(entry)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.#beforeRelease?.();
      // Backstop: if the lock was lost, another writer may have added a line.
      if ((await this.last())?.hash !== entry.hash) throw new StoreError("Another writer changed the file while this entry was written.");
    } finally {
      await this.#release(token);
    }
  }

  /** Remove the lock only when it still holds our token. */
  async #release(token: string): Promise<void> {
    const lock = `${this.#path}.lock`;
    if ((await readFile(lock, "utf8").catch(() => undefined)) === token) await unlink(lock).catch(() => {});
  }

  /** Take the lock file. It holds a random token, so only its owner can release it. */
  async #lock(): Promise<string> {
    const lock = `${this.#path}.lock`;
    const token = randomUUID();
    const deadline = Date.now() + this.#timeout;
    for (;;) {
      try {
        const handle = await open(lock, "wx", 0o600);
        await handle.write(token);
        await handle.close();
        return token;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const seen = await readFile(lock, "utf8").catch(() => undefined);
      const age = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age > STALE_LOCK_MS && seen !== undefined) await this.#takeStale(lock, seen, token);
      else if (Date.now() > deadline) throw new StoreError(`The lock file ${lock} stays. Remove it if no process uses the log.`);
      else await sleep(5 + Math.random() * 20);
    }
  }

  /** Move a stale lock away. The rename is atomic, so one writer wins. */
  async #takeStale(lock: string, seen: string, token: string): Promise<void> {
    const moved = `${lock}.${token}.stale`;
    if (await rename(lock, moved).then(() => false, () => true)) return;
    if ((await readFile(moved, "utf8").catch(() => undefined)) !== seen) {
      // We moved a fresh lock, not the stale one. Put it back.
      await rename(moved, lock).catch(() => {});
      return;
    }
    await unlink(moved).catch(() => {});
  }
}
