// The demo popup. It keeps a foxtrail log in IndexedDB, records demo events,
// shows the log, and exports it as JSONL. The key lives in IndexedDB too.
import { ConflictError, IdbStore, KeyError, Log, exportKeyHex, idbKey, secret } from "../src/index.ts";

const $ = (id) => document.getElementById(id);
const on = (id, handler) => $(id).addEventListener("click", handler);
const say = (text) => ($("status").textContent = text);

async function main() {
  // The demo key is extractable, so the CLI can verify the export. Without
  // that, only code in this browser could verify the log.
  const store = await IdbStore.open("foxtrail-demo");
  const key = await idbKey("foxtrail-demo", { extractable: true });
  const log = new Log({ store, key, redact: ["password"] });

  async function refresh() {
    $("count").textContent = `${await store.count()} entries`;
  }

  async function guard(action) {
    try {
      await action();
    } catch (error) {
      say(`${error.name}: ${error.message}`);
    }
    await refresh();
  }

  on("record", () =>
    guard(async () => {
      await log.append({ actor: "agent", kind: "tool.call", data: { tool: "search", query: "flights to Lisbon" } });
      await log.append({ actor: "agent", kind: "tool.call", data: { tool: "login", user: "pooria", password: "sk-demo-secret" } });
      await log.append({ actor: "agent", kind: "tool.call", data: { tool: "pay", token: secret("sk-demo-secret"), amount: 120 } });
      say("recorded 3 entries");
    }));

  on("race", () =>
    guard(async () => {
      const other = new Log({ store: await IdbStore.open("foxtrail-demo"), key });
      const jobs = Array.from({ length: 20 }, (_v, i) => (i % 2 ? log : other).append({ actor: `writer-${i % 2}`, kind: "race", data: i }));
      await Promise.all(jobs);
      await verifyNow();
    }));

  async function verifyNow() {
    const result = await log.verify();
    say(result.ok ? `ok: ${result.count} entries, head ${result.head}` : `line ${result.index + 1}: ${result.reason}`);
  }

  on("verify", () => guard(verifyNow));

  on("export", () =>
    guard(async () => {
      const text = await log.exportJsonl();
      $("export-out").value = text;
      const link = $("download");
      link.href = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
      link.hidden = false;
      say("exported");
    }));

  on("checkpoint", () =>
    guard(async () => {
      $("checkpoint-out").value = JSON.stringify(await log.checkpoint());
      say("checkpoint made");
    }));

  on("show-key", () => guard(async () => ($("key").textContent = await exportKeyHex(key))));

  on("non-extractable", () =>
    guard(async () => {
      const hidden = await idbKey("foxtrail-demo-hidden");
      try {
        await exportKeyHex(hidden);
        say("exported");
      } catch (error) {
        say(error instanceof KeyError ? "KeyError" : String(error));
      }
    }));

  on("conflict", () =>
    guard(async () => {
      const last = await store.last();
      const stale = { ...last, seq: 0 };
      try {
        await store.append(stale);
        say("accepted");
      } catch (error) {
        say(error instanceof ConflictError ? `ConflictError, count ${await store.count()}` : String(error));
      }
    }));

  await refresh();
}

main();
