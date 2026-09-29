import { buildPackage, PACKAGE_EXT } from "./package";
import { validateManifest } from "./package";
import type { ProjectFile } from "../project/ProjectManager";

/** Developer tools: scaffold an extension project and package it into a .ablixext. */

export interface NewExtensionOptions {
  folder: string; // e.g. "my-extension"
  id: string; // e.g. "me.my-extension"
  name: string;
  description: string;
  author: string;
}

export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "my-extension";

export function scaffoldExtension(o: NewExtensionOptions): ProjectFile[] {
  const manifest = {
    id: o.id,
    name: o.name,
    version: "1.0.0",
    description: o.description,
    author: o.author,
    main: "extension.js",
    permissions: ["editor"],
  };
  const extension = `// ${o.name} — an Ablix extension.
// This file runs in an isolated Web Worker. The \`ablix\` API is passed to activate().
// Docs: commands, menus, keybindings, languages, completions, diagnostics, formatters,
//       snippets, themes, settings, panels, statusBar, editor, workspace.

exports.activate = function activate(ablix) {
  // A command: appears in the Command Palette (Ctrl+Shift+P).
  ablix.commands.register(
    "${o.id}.hello",
    async () => {
      ablix.window.showMessage("Hello from ${o.name}!");
      let doc = null;
      try {
        doc = await ablix.editor.getActiveDocument(); // needs the "editor" permission
      } catch (e) {
        // no workspace is open right now
      }
      if (doc) ablix.window.showMessage("Active file: " + doc.path + " (" + doc.text.length + " chars)");
      return "hello";
    },
    { title: "${o.name}: Say Hello" }
  );

  // A status bar item that runs the command when tapped.
  ablix.statusBar.create({ id: "hello", text: "Hello", tooltip: "Say hello", command: "${o.id}.hello" });

  // A snippet: type "hello" in a .js file and pick it from the suggestions.
  ablix.snippets.register("js", [
    { prefix: "hello", body: "console.log(\\"Hello, \${1:world}!\\");", description: "Log a greeting" },
  ]);

  // Right-click a file in the editor to see this menu entry.
  ablix.menus.register({ location: "editor/context", command: "${o.id}.hello", title: "${o.name}: Say Hello" });
};

exports.deactivate = function deactivate() {};
`;
  const readme = `# ${o.name}

${o.description}

## Commands

- **${o.name}: Say Hello** (\`${o.id}.hello\`) — shows a greeting.

## Develop

1. Edit \`extension.js\`.
2. Use **Package Extension** on this folder to build \`${o.folder}${PACKAGE_EXT}\`.
3. Install the package from the Extensions panel (Install from file).
`;
  return [
    { path: `${o.folder}/manifest.json`, content: JSON.stringify(manifest, null, 2) + "\n" },
    { path: `${o.folder}/extension.js`, content: extension },
    { path: `${o.folder}/README.md`, content: readme },
  ];
}

/** Folders in the project that contain a manifest.json (candidates for packaging). */
export function findExtensionFolders(files: ProjectFile[]): string[] {
  return files
    .map((f) => f.path)
    .filter((p) => p === "manifest.json" || p.endsWith("/manifest.json"))
    .map((p) => p.slice(0, Math.max(0, p.length - "manifest.json".length - 1)));
}

/** Packages the files under `folder` (relative to the project root) into .ablixext bytes. */
export async function packageExtensionFolder(files: ProjectFile[], folder: string) {
  const prefix = folder ? `${folder}/` : "";
  const inFolder: Record<string, string> = {};
  for (const f of files) {
    if (!f.path.startsWith(prefix) || f.path.endsWith("/.keep")) continue;
    inFolder[f.path.slice(prefix.length)] = f.content;
  }
  if (!inFolder["manifest.json"]) throw new Error(`"${folder || "/"}" has no manifest.json`);
  let manifestRaw: unknown;
  try { manifestRaw = JSON.parse(inFolder["manifest.json"]); } catch { throw new Error("manifest.json is not valid JSON"); }
  const manifest = validateManifest(manifestRaw); // throws PackageError with a readable reason
  if (!(manifest.main in inFolder)) throw new Error(`${manifest.main} (manifest.main) is missing`);
  if (!inFolder["README.md"]) throw new Error("README.md is missing");
  const bytes = await buildPackage(inFolder);
  const base = slugify(manifest.id);
  return { bytes, manifest, filename: `${base}-${manifest.version}${PACKAGE_EXT}` };
}
