/* End-to-end test of the extension system (Node, in-process worker transport).
 * Uses the REAL package format, validator, host, runtime, service, store (fake IndexedDB),
 * Appwrite SDK (fetch stubbed) and the scaffold/package dev tools. */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { createExtensionRuntime } from "../src/extensions/worker/runtime.js";
import type { WorkerLike } from "../src/extensions/host/ExtensionHost";
import { ExtensionService } from "../src/extensions/ExtensionService";
import { buildPackage, parsePackage, PackageError } from "../src/extensions/package";
import { scaffoldExtension, packageExtensionFolder, findExtensionFolders } from "../src/extensions/devtools";
import { fetchMarketplace, type MarketplaceRow } from "../src/extensions/marketplace";
import { compareVersions } from "../src/extensions/semver";
import { expandSnippet } from "../src/extensions/snippets";
import { normalizeKey } from "../src/extensions/keys";
import { appwriteConfig } from "../src/appwrite/client";

let passed = 0;
async function step(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n`, e); process.exit(1); }
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function fakeWorker(): WorkerLike {
  let dead = false;
  const w: WorkerLike = {
    onmessage: null, onerror: null,
    postMessage(m) { if (!dead) setTimeout(() => !dead && rt.handle(structuredClone(m)), 0); },
    terminate() { dead = true; },
  };
  const rt = createExtensionRuntime((m) => { setTimeout(() => !dead && w.onmessage?.({ data: structuredClone(m) }), 0); });
  return w;
}

let svc = new ExtensionService(() => fakeWorker());
let openDoc = { path: "a.js", language: "js", text: "let x = 1;", selection: { start: 0, end: 0 } };
const bridgeCalls: string[] = [];
const attachBridge = (s: ExtensionService) => s.host.setBridge({
  getActiveDocument: () => openDoc,
  replaceContent: (t) => { openDoc = { ...openDoc, text: t }; bridgeCalls.push("replace"); },
  replaceSelection: () => {}, insertText: () => {},
  readFile: (p) => (p === "a.js" ? openDoc.text : null), writeFile: async () => {}, listFiles: () => ["a.js"],
});
attachBridge(svc);
await svc.start();

console.log("Package format");
const opts = { folder: "my-extension", id: "test.hello", name: "Hello Test", description: "A test extension", author: "Tester" };
const project = scaffoldExtension(opts);
let packaged!: Awaited<ReturnType<typeof packageExtensionFolder>>;

await step("scaffold creates manifest.json, extension.js, README.md", () => {
  assert.deepEqual(project.map((f) => f.path).sort(), ["my-extension/README.md", "my-extension/extension.js", "my-extension/manifest.json"]);
  assert.deepEqual(findExtensionFolders(project), ["my-extension"]);
});
await step("package extension -> .ablixext zip", async () => {
  packaged = await packageExtensionFolder(project, "my-extension");
  assert.match(packaged.filename, /\.ablixext$/);
  assert.equal(packaged.bytes[0], 0x50); // "PK" zip magic
  assert.equal(packaged.bytes[1], 0x4b);
});
await step("parse + validate manifest from the package", async () => {
  const pkg = await parsePackage(packaged.bytes);
  assert.equal(pkg.manifest.id, "test.hello");
  assert.deepEqual(Object.keys(pkg.files).sort(), ["README.md", "extension.js", "manifest.json"]);
});
await step("validation rejects bad packages with readable errors", async () => {
  const bad = async (files: Record<string, string>, re: RegExp) =>
    assert.rejects(parsePackage(await buildPackage(files)), (e: unknown) => e instanceof PackageError && re.test(e.message));
  const m = { id: "a.b", name: "N", version: "1.0.0", description: "d", author: "a", main: "extension.js" };
  await assert.rejects(parsePackage(new TextEncoder().encode("not a zip")), /not a ZIP/);
  await bad({ "extension.js": "", "README.md": "" }, /missing manifest\.json/);
  await bad({ "manifest.json": "{oops", "extension.js": "", "README.md": "" }, /not valid JSON/);
  await bad({ "manifest.json": JSON.stringify({ ...m, id: "bad id!" }), "extension.js": "", "README.md": "" }, /"id"/);
  await bad({ "manifest.json": JSON.stringify({ ...m, version: "one" }), "extension.js": "", "README.md": "" }, /version/);
  await bad({ "manifest.json": JSON.stringify({ ...m, main: "../evil.js" }), "extension.js": "", "README.md": "" }, /relative path/);
  await bad({ "manifest.json": JSON.stringify(m), "README.md": "" }, /missing extension\.js/);
  await bad({ "manifest.json": JSON.stringify(m), "extension.js": "" }, /missing README\.md/);
  await bad({ "manifest.json": JSON.stringify({ ...m, permissions: ["root"] }), "extension.js": "", "README.md": "" }, /unknown permission/);
  await bad({ "manifest.json": JSON.stringify({ ...m, author: undefined }), "extension.js": "", "README.md": "" }, /"author" is required/);
});
await step("package inside a single top-level folder is accepted", async () => {
  const files: Record<string, string> = {};
  for (const f of project) files[f.path] = f.content; // my-extension/manifest.json ...
  assert.equal((await parsePackage(await buildPackage(files))).manifest.id, "test.hello");
});

console.log("Install / activate / run");
await step("install .ablixext -> stored + activated in the host", async () => {
  const { ext } = await svc.installPackage(packaged.bytes);
  assert.equal(ext.enabled, true);
  assert.equal(svc.find("test.hello")?.manifest.version, "1.0.0");
  assert.equal(svc.host.isRunning("test.hello"), true);
});
await step("extension registered its contributions", () => {
  const s = svc.host.getSnapshot();
  assert.ok(s.commands.some((c) => c.id === "test.hello.hello" && c.extId === "test.hello"));
  assert.ok(s.statusItems.some((i) => i.text === "Hello"));
  assert.ok(s.menus.some((m) => m.location === "editor/context"));
});
await step("execute the command (uses editor API with permission)", async () => {
  const result = await svc.host.executeCommand("test.hello.hello");
  assert.equal(result, "hello");
  await tick();
  const texts = svc.host.getSnapshot().toasts.map((t) => t.text);
  assert.ok(texts.includes("Hello from Hello Test!"), texts.join("|"));
  assert.ok(texts.some((t) => t.startsWith("Active file: a.js")));
});
await step("snippet shows up as a completion", async () => {
  const items = await svc.host.provideCompletions(openDoc, 0);
  assert.ok(items.some((i) => i.label === "hello" && i.isSnippet));
});
await step("disable -> deactivated, contributions removed, command unavailable", async () => {
  await svc.setEnabled("test.hello", false);
  assert.equal(svc.host.isRunning("test.hello"), false);
  assert.equal(svc.host.getSnapshot().commands.some((c) => c.id === "test.hello.hello"), false);
  assert.equal(svc.host.getSnapshot().statusItems.length, 0);
  await assert.rejects(svc.host.executeCommand("test.hello.hello"), /not found/);
  assert.equal(svc.find("test.hello")?.enabled, false);
});
await step("enable -> runs again", async () => {
  await svc.setEnabled("test.hello", true);
  assert.equal(svc.host.isRunning("test.hello"), true);
  assert.equal(await svc.host.executeCommand("test.hello.hello"), "hello");
});
await step("installed state persists across restart (new service, same IndexedDB)", async () => {
  svc.host.dispose();
  svc = new ExtensionService(() => fakeWorker());
  attachBridge(svc);
  await svc.start();
  assert.equal(svc.find("test.hello")?.manifest.name, "Hello Test");
  assert.equal(svc.host.isRunning("test.hello"), true);
  assert.equal(await svc.host.executeCommand("test.hello.hello"), "hello");
});

console.log("Permissions & isolation");
const mk = (id: string, code: string, extra: Record<string, unknown> = {}, more: Record<string, string> = {}) =>
  buildPackage({
    "manifest.json": JSON.stringify({ id, name: id, version: "1.0.0", description: "d", author: "a", main: "extension.js", ...extra }),
    "extension.js": code, "README.md": "# r", ...more,
  });
await step("no 'editor' permission -> API call is refused by the host", async () => {
  await svc.installPackage(await mk("t.noperm", `exports.activate = (a) => a.commands.register("t.noperm.go", () => a.editor.getActiveDocument());`));
  await assert.rejects(svc.host.executeCommand("t.noperm.go"), /needs the "editor" permission/);
});
await step("workspace permission gates file access", async () => {
  await svc.installPackage(await mk("t.ws", `exports.activate = (a) => { a.commands.register("t.ws.read", () => a.workspace.readFile("a.js")); };`, { permissions: ["workspace"] }));
  assert.equal(await svc.host.executeCommand("t.ws.read"), "let x = 1;");
});
await step("activation error is reported, extension not running", async () => {
  await svc.installPackage(await mk("t.broken", `exports.activate = () => { throw new Error("boom"); };`));
  assert.equal(svc.host.isRunning("t.broken"), false);
  assert.match(svc.host.getSnapshot().errors["t.broken"], /boom/);
});
await step("host rejects invalid/reserved registrations", async () => {
  await svc.installPackage(await mk("t.bad", `exports.activate = (a) => {
    a.commands.register("ablix.evil", () => 1);           // reserved prefix
    a.keybindings.register({ key: "Ctrl+S", command: "x" }); // reserved key
    a.themes.register({ id: "t", name: "T", colors: { accent: "url(http://x)", bogus: "#fff", text: "#eee" } });
  };`));
  const s = svc.host.getSnapshot();
  assert.equal(s.commands.some((c) => c.id === "ablix.evil" && c.extId === "t.bad"), false);
  assert.equal(s.keybindings.some((k) => k.extId === "t.bad"), false);
  assert.deepEqual(s.themes.find((t) => t.extId === "t.bad")?.colors, { text: "#eee" });
});

console.log("Full contribution surface");
const RICH = `
const util = require("./lib/util");
exports.activate = (ablix) => {
  ablix.commands.register("rich.upper", async () => { const d = await ablix.editor.getActiveDocument(); await ablix.editor.replaceContent(util.upper(d.text)); return util.version; }, { title: "Rich: Upper" });
  ablix.keybindings.register({ key: "ctrl+alt+u", command: "rich.upper" });
  ablix.languages.register({ id: "todo", name: "Todo", extensions: [".todo"], rules: [
    { pattern: "^\\\\s*TODO\\\\b", token: "keyword" }, { pattern: "#[a-z]+", flags: "i", token: "tag" } ] });
  ablix.completions.register({ languages: ["js"] }, { provideCompletions: (doc) => [{ label: "richHelper", detail: "from rich (" + doc.path + ")", kind: "function" }] });
  ablix.diagnostics.register({ languages: ["js"] }, { provideDiagnostics: (doc) =>
    doc.text.split("\\n").flatMap((l, i) => l.includes("debugger") ? [{ line: i + 1, column: 1, message: "Remove debugger", severity: "warning" }] : []) });
  ablix.formatters.register({ languages: ["js"] }, { formatDocument: (doc) => doc.text.replace(/[ \\t]+$/gm, "") + "\\n" });
  ablix.themes.register({ id: "midnight", name: "Rich Midnight", colors: { accent: "#ff00aa", surface: "#000011", keyword: "#00ffaa" } });
  ablix.settings.register([{ key: "shout", title: "Shout", type: "boolean", default: false }, { key: "mode", title: "Mode", type: "enum", default: "a", options: ["a", "b"] }]);
  ablix.settings.onDidChange((k, v) => ablix.window.showMessage("setting " + k + "=" + v));
  const panel = ablix.panels.register({ id: "main", title: "Rich Panel", icon: "list" });
  panel.setContent({ type: "column", children: [{ type: "heading", text: "Hi" }, { type: "button", label: "Go", command: "rich.upper" }, { type: "script", text: "<img onerror=x>" }] });
  const st = ablix.statusBar.create({ id: "s", text: "one", alignment: "right" });
  ablix.commands.register("rich.bump", () => { st.update({ text: "two" }); return ablix.settings.get("shout"); });
  ablix.commands.register("rich.pick", async () => { const p = await ablix.window.showQuickPick(["x", { label: "Y", value: 7 }]); return p; });
};`;
await step("install extension using every contribution type + require()", async () => {
  await svc.installPackage(await mk("rich.ext", RICH, { permissions: ["editor"] }, { "lib/util.js": `exports.upper = (s) => s.toUpperCase(); exports.version = require("../data.json").v;`, "data.json": `{"v": "9.9"}` }));
  assert.equal(svc.host.isRunning("rich.ext"), true, JSON.stringify(svc.host.getSnapshot().errors));
});
await step("command + keybinding + editor.replaceContent + require()", async () => {
  assert.equal(svc.host.getSnapshot().keybindings.find((k) => k.command === "rich.upper")?.key, "ctrl+alt+u");
  assert.equal(await svc.host.executeCommand("rich.upper"), "9.9");
  assert.equal(openDoc.text, "LET X = 1;");
  openDoc = { ...openDoc, text: "let x = 1;" };
});
await step("language contribution", () => {
  const l = svc.host.getSnapshot().languages.find((x) => x.id === "todo");
  assert.deepEqual(l?.extensions, [".todo"]);
  assert.equal(l?.rules.length, 2);
});
await step("autocomplete provider", async () => {
  const items = await svc.host.provideCompletions(openDoc, 3);
  assert.ok(items.some((i) => i.label === "richHelper" && i.detail === "from rich (a.js)"));
  assert.equal((await svc.host.provideCompletions({ ...openDoc, language: "py" }, 0)).some((i) => i.label === "richHelper"), false);
});
await step("diagnostics provider", async () => {
  const d = await svc.host.provideDiagnostics({ ...openDoc, text: "a();\ndebugger;\n" });
  assert.deepEqual(d.map((x) => [x.line, x.severity, x.message]), [[2, "warning", "Remove debugger"]]);
});
await step("formatter", async () => {
  assert.equal(await svc.host.formatDocument({ ...openDoc, text: "a();   \nb();\t" }), "a();\nb();\n");
  assert.equal(await svc.host.formatDocument({ ...openDoc, language: "py" }), null);
});
await step("theme (sanitized) + selection persisted", async () => {
  const t = svc.host.getSnapshot().themes.find((x) => x.id === "midnight");
  assert.equal(t?.colors.accent, "#ff00aa");
  await svc.host.setTheme("rich.ext::midnight");
  assert.equal(svc.host.activeTheme()?.name, "Rich Midnight");
});
await step("settings: defaults, validation, persistence, change event", async () => {
  assert.equal(svc.host.getSetting("rich.ext", "shout"), false);
  assert.equal(await svc.host.setSetting("rich.ext", "shout", "yes"), false); // wrong type
  assert.equal(await svc.host.setSetting("rich.ext", "mode", "zzz"), false); // not in enum
  assert.equal(await svc.host.setSetting("rich.ext", "shout", true), true);
  await tick();
  assert.ok(svc.host.getSnapshot().toasts.some((t) => t.text === "setting shout=true"));
  assert.equal(await svc.host.executeCommand("rich.bump"), true); // extension sees the new value
});
await step("panel content is sanitized (unknown node types dropped) + status item updates", () => {
  const p = svc.host.getSnapshot().panels.find((x) => x.id === "main");
  assert.equal(p?.icon, "list");
  const content = p?.content as { type: string; children: { type: string }[] };
  assert.deepEqual(content.children.map((c) => c.type), ["heading", "button"]);
  assert.equal(svc.host.getSnapshot().statusItems.find((s) => s.id === "s")?.text, "two");
});
await step("showQuickPick round-trips through the host UI", async () => {
  const pending = svc.host.executeCommand("rich.pick");
  await tick();
  const qp = svc.host.getSnapshot().quickPick;
  assert.deepEqual(qp?.items.map((i) => i.label), ["x", "Y"]);
  qp!.resolve(qp!.items[1]);
  assert.deepEqual(await pending, { label: "Y", value: 7 });
});

console.log("Marketplace (Appwrite SDK, fetch stubbed) / updates");
const realFetch = globalThis.fetch;
const v1 = await mk("mkt.ext", `exports.activate=(a)=>a.commands.register("mkt.v",()=>"v1");`, { version: "1.0.0" });
const v2 = await mk("mkt.ext", `exports.activate=(a)=>a.commands.register("mkt.v",()=>"v2");`, { version: "1.1.0" });
const served: Record<string, Uint8Array> = { file_v1: v1, file_v2: v2 };
const hits: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  hits.push(`${init?.method ?? "GET"} ${url}`);
  const file = /\/files\/([^/]+)\/download/.exec(url)?.[1];
  if (file) return served[file] ? new Response(served[file], { status: 200 }) : new Response("nf", { status: 404 });
  if (/rows/.test(url) && (init?.method ?? "GET") === "GET") {
    return new Response(JSON.stringify({ total: 2, rows: [
      { $id: "row1", name: "Mkt Ext", version: "1.0.0", description: "d", category: "Tools", author: "Ann", icon: "puzzle-piece", downloads: 5, fileId: "file_v1" },
      { $id: "row0", name: "No file", version: "1.0.0", fileId: "" },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ message: "stub", code: 404 }), { status: 404, headers: { "content-type": "application/json" } });
}) as typeof fetch;
let rows: MarketplaceRow[] = [];
await step("fetch listing from the Appwrite table (fields mapped, rows without fileId skipped)", async () => {
  rows = await fetchMarketplace();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { rowId: "row1", name: "Mkt Ext", version: "1.0.0", description: "d", category: "Tools", author: "Ann", icon: "puzzle-piece", downloads: 5, fileId: "file_v1" });
  assert.ok(hits.some((h) => h.includes(appwriteConfig.databaseId) && h.includes(appwriteConfig.tableId)), hits.join("\n"));
});
await step("state is 'install' before, then download by fileId from the bucket -> install", async () => {
  assert.equal(svc.marketplaceState(rows[0]), "install");
  await svc.installFromMarketplace(rows[0]);
  assert.ok(hits.some((h) => h.includes(`/storage/buckets/${appwriteConfig.bucketId}/files/file_v1/download`)), hits.join("\n"));
  assert.equal(await svc.host.executeCommand("mkt.v"), "v1");
  assert.equal(svc.marketplaceState(rows[0]), "installed");
});
await step("newer version in marketplace -> 'update' -> update keeps it enabled and runs new code", async () => {
  const newer = { ...rows[0], version: "1.1.0", fileId: "file_v2" };
  assert.equal(svc.marketplaceState(newer), "update");
  const { previous, ext } = await svc.installFromMarketplace(newer);
  assert.equal(previous?.manifest.version, "1.0.0");
  assert.equal(ext.manifest.version, "1.1.0");
  assert.equal(await svc.host.executeCommand("mkt.v"), "v2");
  assert.equal(svc.marketplaceState(newer), "installed");
});
await step("missing file in storage -> clear error", async () => {
  await assert.rejects(svc.installFromMarketplace({ ...rows[0], rowId: "rowX", fileId: "nope" }), /not found in storage/);
});
globalThis.fetch = realFetch;
await step("semver ordering", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta"), 1);
  assert.equal(compareVersions("2.0.0", "10.0.0"), -1);
});

console.log("Editor helpers");
await step("snippet expansion: placeholders, tabstops, escapes", () => {
  assert.deepEqual(expandSnippet('console.log("Hi, ${1:world}!");'), { text: 'console.log("Hi, world!");', start: 17, end: 22 });
  assert.deepEqual(expandSnippet("if ($1) {\n  $0\n}"), { text: "if () {\n  \n}", start: 4, end: 4 });
  assert.equal(expandSnippet("cost: \\$5").text, "cost: $5");
});
await step("keybinding normalization and safety", async () => {
  assert.equal(normalizeKey("Shift+Ctrl+K"), "ctrl+shift+k");
  assert.equal(normalizeKey("Cmd+Alt+/"), "alt+meta+/");
  await svc.installPackage(await mk("t.keys", `exports.activate=(a)=>{
    a.commands.register("t.keys.c",()=>1);
    a.keybindings.register({key:"k",command:"t.keys.c"});          // plain key would break typing
    a.keybindings.register({key:"shift+k",command:"t.keys.c"});    // shift alone too
    a.keybindings.register({key:"ctrl+alt+k",command:"t.keys.c"}); // fine
  };`));
  assert.deepEqual(svc.host.getSnapshot().keybindings.filter((k) => k.extId === "t.keys").map((k) => k.key), ["ctrl+alt+k"]);
});

console.log("Uninstall");
await step("uninstall removes package, settings, contributions", async () => {
  await svc.uninstall("rich.ext");
  assert.equal(svc.find("rich.ext"), undefined);
  assert.equal(svc.host.isRunning("rich.ext"), false);
  assert.equal(svc.host.getSnapshot().commands.some((c) => c.extId === "rich.ext"), false);
  assert.equal(svc.host.getSnapshot().languages.some((l) => l.extId === "rich.ext"), false);
  assert.equal(svc.host.activeTheme(), null);
  svc.host.dispose();
  const fresh = new ExtensionService(() => fakeWorker());
  await fresh.start();
  assert.equal(fresh.find("rich.ext"), undefined);
  assert.ok(fresh.find("test.hello"));
  fresh.host.dispose();
});

console.log(`\n${passed} checks passed`);
process.exit(0);
