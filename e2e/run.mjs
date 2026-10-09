// The E2E test: load the demo extension in a real Firefox, record events in
// its popup, export the log, and check the export with the real CLI.
// It writes artifacts/e2e-<date>.json. Usage: pnpm e2e [--headed].
// Env: FIREFOX (the Firefox binary).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, poll, writeArtifact } from "create-foxkit/e2e";

const record = { startedAt: new Date().toISOString(), checks: [] };
const check = (name, expected, actual) => record.checks.push({ name, expected, actual, ok: actual === expected });

const cli = (args) => {
  const r = spawnSync(process.execPath, ["dist/bin.js", ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
};
const click = (page, id) => page.evaluate((i) => document.getElementById(i).click(), id);
const waitFor = (page, id, prefix) =>
  poll(page, ({ i, p }) => document.getElementById(i)?.textContent?.startsWith(p) && document.getElementById(i).textContent, { i: id, p: prefix });

let fox;
try {
  fox = await launch({ extension: "dist-ext", headless: !process.argv.includes("--headed") });
  record.firefox = await fox.browser.version();
  const popup = await fox.openExtensionPage("popup.html");

  await click(popup, "record");
  check("record", "3 entries", await waitFor(popup, "count", "3 entries"));
  await click(popup, "race");
  check("race", "ok: 23 entries", (await waitFor(popup, "status", "ok: 23 entries")).slice(0, 14));
  await click(popup, "non-extractable");
  check("non-extractable", "KeyError", await waitFor(popup, "status", "KeyError"));
  await click(popup, "conflict");
  check("conflict", "ConflictError, count 23", await waitFor(popup, "status", "ConflictError"));

  await popup.close();
  const again = await fox.openExtensionPage("popup.html");
  check("reload", "23 entries", await waitFor(again, "count", "23 entries"));
  await click(again, "verify");
  check("reload verify", "ok: 23 entries", (await waitFor(again, "status", "ok: 23 entries")).slice(0, 14));

  await click(again, "export");
  await click(again, "show-key");
  await click(again, "checkpoint");
  const jsonl = await poll(again, () => document.getElementById("export-out").value);
  const key = await poll(again, () => document.getElementById("key").textContent);
  const checkpoint = await poll(again, () => document.getElementById("checkpoint-out").value);

  const dir = mkdtempSync(join(tmpdir(), "foxtrail-e2e-"));
  const files = { log: join(dir, "log.jsonl"), key: join(dir, "key"), cp: join(dir, "checkpoint.json") };
  writeFileSync(files.log, jsonl);
  writeFileSync(files.key, `${key}\n`);
  writeFileSync(files.cp, checkpoint);

  check("redaction", false, jsonl.includes("sk-sample-secret"));
  const good = cli(["verify", files.log, "--key", files.key, "--checkpoint", files.cp]);
  check("cli-good", 0, good.code);
  record.cliGood = good.out;

  const lines = jsonl.split("\n");
  const tampered = join(dir, "tampered.jsonl");
  const target = lines[1];
  const at = target.indexOf('"kind":"') + 8;
  const flipped = target.slice(0, at) + (target[at] === "x" ? "y" : "x") + target.slice(at + 1);
  writeFileSync(tampered, [lines[0], flipped, ...lines.slice(2)].join("\n"));
  const bad = cli(["verify", tampered, "--key", files.key]);
  check("cli-tamper", "1 line 2", `${bad.code} ${/^line \d+/.exec(bad.err)?.[0]}`);
  record.cliTamper = bad.err;

  const cut = join(dir, "cut.jsonl");
  writeFileSync(cut, `${lines.slice(0, 10).join("\n")}\n`);
  const noCheckpoint = cli(["verify", cut, "--key", files.key]);
  const withCheckpoint = cli(["verify", cut, "--key", files.key, "--checkpoint", files.cp]);
  check("cli-truncate", "0 1 line 11", `${noCheckpoint.code} ${withCheckpoint.code} ${/^line \d+/.exec(withCheckpoint.err)?.[0]}`);
  record.cliTruncate = withCheckpoint.err;
} catch (error) {
  record.error = error instanceof Error ? error.message : String(error);
} finally {
  await fox?.close();
}
record.passed = !record.error && record.checks.length === 10 && record.checks.every((c) => c.ok);
const path = writeArtifact("artifacts", "e2e", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}: ${c.actual}`);
console.log(`${record.passed ? "PASS" : "FAIL"}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;
