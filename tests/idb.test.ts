import { describe, expect, it } from "vitest";
import { StoreError } from "../src/errors.js";
import { IdbStore } from "../src/idb.js";

describe("IdbStore", () => {
  it("I5: throws StoreError when the page has no IndexedDB", async () => {
    await expect(IdbStore.open("x")).rejects.toThrow(StoreError);
  });
});
