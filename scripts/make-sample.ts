/* Builds a ready-to-publish sample .ablixext:  npx tsx scripts/make-sample.ts <out-dir> */
import { writeFileSync } from "node:fs";
import { packageExtensionFolder, scaffoldExtension } from "../src/extensions/devtools";

const out = process.argv[2] ?? ".";
const files = scaffoldExtension({
  folder: "hello-world", id: "ablix.hello-world", name: "Hello World",
  description: "Sample Ablix extension: a command, status bar item, snippet and editor menu entry.", author: "Ablix Community",
});
const { bytes, filename } = await packageExtensionFolder(files, "hello-world");
writeFileSync(`${out}/${filename}`, bytes);
console.log(`${out}/${filename} (${bytes.length} bytes)`);
