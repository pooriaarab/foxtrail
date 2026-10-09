import { GENESIS } from "./constants.js";
import { ConflictError, StoreError } from "./errors.js";
import { generateKey } from "./keys.js";
import type { Entry, Store } from "./types.js";

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.addEventListener("success", () => resolve(r.result));
    r.addEventListener("error", () => reject(r.error));
  });

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.addEventListener("complete", () => resolve());
    tx.addEventListener("error", () => reject(tx.error));
    tx.addEventListener("abort", () => reject(tx.error ?? new Error("The transaction was aborted.")));
  });

function open(name: string): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new StoreError("IndexedDB is not available here."));
  const opening = indexedDB.open(name, 1);
  opening.addEventListener("upgradeneeded", () => {
    opening.result.createObjectStore("entries", { keyPath: "seq" });
    opening.result.createObjectStore("keys");
  });
  return request(opening);
}

/** A store in IndexedDB. Every write checks the log head inside one transaction. */
export class IdbStore implements Store {
  readonly #db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.#db = db;
  }

  static async open(name = "foxtrail"): Promise<IdbStore> {
    return new IdbStore(await open(name));
  }

  async all(): Promise<Entry[]> {
    return request(this.#db.transaction("entries").objectStore("entries").getAll());
  }

  async count(): Promise<number> {
    return request(this.#db.transaction("entries").objectStore("entries").count());
  }

  async last(): Promise<Entry | undefined> {
    const cursor = await request(this.#db.transaction("entries").objectStore("entries").openCursor(null, "prev"));
    return cursor?.value as Entry | undefined;
  }

  async append(entry: Entry): Promise<void> {
    const tx = this.#db.transaction("entries", "readwrite");
    const done = finished(tx);
    done.catch(() => {});
    const store = tx.objectStore("entries");
    const [count, before] = await Promise.all([request(store.count()), entry.seq > 0 ? request(store.get(entry.seq - 1)) : undefined]);
    const head = entry.seq === 0 ? GENESIS : (before as Entry | undefined)?.hash;
    if (count !== entry.seq || head !== entry.prev) {
      tx.abort();
      await done.catch(() => {});
      throw new ConflictError(`The log has ${count} entries. Entry ${entry.seq} does not fit.`);
    }
    store.add(entry);
    await done;
  }
}

/**
 * The log key, kept in IndexedDB as a CryptoKey object. It is non-extractable
 * unless you ask: the browser keeps the bytes, and code cannot read them.
 * The first call makes the key. Later calls, also from other tabs, get it back.
 */
export async function idbKey(name = "foxtrail", options: { extractable?: boolean } = {}): Promise<CryptoKey> {
  const db = await open(name);
  try {
    const read = () => request(db.transaction("keys").objectStore("keys").get("hmac")) as Promise<CryptoKey | undefined>;
    const existing = await read();
    if (existing) return existing;
    const fresh = await generateKey(options);
    const tx = db.transaction("keys", "readwrite");
    // add() fails when another tab won the race. Then we read their key.
    tx.objectStore("keys").add(fresh, "hmac");
    await finished(tx).catch(() => {});
    return (await read()) ?? fresh;
  } finally {
    db.close();
  }
}
