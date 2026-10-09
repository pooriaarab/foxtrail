/** Base class for every error that foxtrail throws on purpose. */
export class FoxtrailError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The value is not plain JSON, or an entry field has the wrong shape. */
export class InvalidEntryError extends FoxtrailError {
  constructor(message: string) {
    super("invalid-entry", message);
  }
}

/** The key is missing, too short, malformed, or not a usable HMAC key. */
export class KeyError extends FoxtrailError {
  constructor(message: string) {
    super("key", message);
  }
}

/** The entry is larger than the `maxEntryBytes` limit. */
export class EntryTooLargeError extends FoxtrailError {
  constructor(message: string) {
    super("entry-too-large", message);
  }
}

/** A store refused an entry because the log moved on. The caller retries. */
export class ConflictError extends FoxtrailError {
  constructor(message: string) {
    super("conflict", message);
  }
}

/** A store cannot read or write its data: a partial line, bad JSON, or a stuck lock. */
export class StoreError extends FoxtrailError {
  constructor(message: string) {
    super("store", message);
  }
}
