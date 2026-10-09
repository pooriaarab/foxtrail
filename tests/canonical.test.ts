import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/canonical.js";
import { InvalidEntryError } from "../src/errors.js";

describe("canonicalize", () => {
  it("C1: ignores key order at every depth", () => {
    const a = { b: 1, a: { y: [1, { d: 4, c: 3 }], x: null } };
    const b = { a: { x: null, y: [1, { c: 3, d: 4 }] }, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":{"x":null,"y":[1,{"c":3,"d":4}]},"b":1}');
  });

  it("C2: keeps NFC and NFD apart", () => {
    const nfc = "é";
    const nfd = "é";
    expect(nfc).not.toBe(nfd);
    expect(canonicalize({ s: nfc })).not.toBe(canonicalize({ s: nfd }));
  });

  it("C3: escapes a lone surrogate", () => {
    const text = canonicalize({ s: "a\ud800b" });
    expect(text).toBe('{"s":"a\\ud800b"}');
    expect(text).not.toBe(canonicalize({ s: "a�b" }));
  });

  it.each([
    ["undefined", undefined],
    ["undefined property", { a: undefined }],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["bigint", 1n],
    ["function", () => 1],
    ["symbol", Symbol("x")],
    ["Date", new Date(0)],
    ["Map", new Map()],
    ["undefined array item", [1, undefined, 3]],
  ])("C4: rejects %s", (_name, value) => {
    expect(() => canonicalize(value)).toThrow(InvalidEntryError);
  });

  it("C5: rejects a cycle and a very deep value", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalize(loop)).toThrow(InvalidEntryError);
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = [deep];
    expect(() => canonicalize(deep)).toThrow(InvalidEntryError);
  });

  it("C6: keeps an own __proto__ key", () => {
    const parsed = JSON.parse('{"__proto__":1,"a":2}');
    expect(canonicalize(parsed)).toBe('{"__proto__":1,"a":2}');
  });
});
