import { PERMISSIONS, type ExtensionManifest, type Permission } from "./types";
import { isValidVersion } from "./semver";

/**
 * .ablixext = a ZIP archive containing at minimum:
 *   manifest.json   metadata (id, name, version, description, author, main)
 *   extension.js    the entry point named by manifest.main
 *   README.md
 * Extra text files (.js/.json/.md/.txt/.css) are kept so extension.js can require() them.
 */

export const PACKAGE_EXT = ".ablixext";
export const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const TEXT_FILE_RE = /\.(js|json|md|txt|css)$/i;
const ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;

export class PackageError extends Error {}

export interface ParsedPackage {
  manifest: ExtensionManifest;
  files: Record<string, string>;
  readme: string;
}

function str(v: unknown, field: string, max: number, required = true): string {
  if (v === undefined || v === null || v === "") {
    if (required) throw new PackageError(`manifest.json: "${field}" is required`);
    return "";
  }
  if (typeof v !== "string") throw new PackageError(`manifest.json: "${field}" must be a string`);
  if (v.length > max) throw new PackageError(`manifest.json: "${field}" is too long (max ${max})`);
  return v;
}

export function validateManifest(raw: unknown): ExtensionManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PackageError("manifest.json must be a JSON object");
  }
  const m = raw as Record<string, unknown>;
  const id = str(m.id, "id", 80);
  if (!ID_RE.test(id)) {
    throw new PackageError('manifest.json: "id" may only contain letters, digits, ".", "-" and "_" (e.g. "acme.hello")');
  }
  const version = str(m.version, "version", 40);
  if (!isValidVersion(version)) throw new PackageError('manifest.json: "version" must look like 1.0.0');
  const main = str(m.main, "main", 120);
  if (main.startsWith("/") || main.includes("..") || main.includes("\\")) {
    throw new PackageError('manifest.json: "main" must be a relative path inside the package');
  }
  if (!/\.js$/i.test(main)) throw new PackageError('manifest.json: "main" must point to a .js file');

  let permissions: Permission[] | undefined;
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) throw new PackageError('manifest.json: "permissions" must be an array');
    for (const p of m.permissions) {
      if (!PERMISSIONS.includes(p as Permission)) {
        throw new PackageError(`manifest.json: unknown permission "${String(p)}" (allowed: ${PERMISSIONS.join(", ")})`);
      }
    }
    permissions = [...new Set(m.permissions as Permission[])];
  }

  return {
    id,
    name: str(m.name, "name", 80),
    version,
    description: str(m.description, "description", 500),
    author: str(m.author, "author", 120),
    main: main.replace(/^\.\//, ""),
    permissions,
    category: str(m.category, "category", 40, false) || undefined,
    icon: str(m.icon, "icon", 300, false) || undefined,
  };
}

/** Reads, extracts and validates a .ablixext package. Throws PackageError with a user-readable reason. */
export async function parsePackage(data: ArrayBuffer | Uint8Array): Promise<ParsedPackage> {
  const size = data.byteLength;
  if (size === 0) throw new PackageError("The package is empty");
  if (size > MAX_PACKAGE_BYTES) throw new PackageError("The package is larger than 10 MB");

  const { default: JSZip } = await import("jszip");
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new PackageError("Not a valid .ablixext package (the file is not a ZIP archive)");
  }

  // Everything may live at the archive root or inside a single top-level folder (e.g. my-extension/).
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const hasRootManifest = names.includes("manifest.json");
  let prefix = "";
  if (!hasRootManifest) {
    const nested = names.filter((n) => /^[^/]+\/manifest\.json$/.test(n));
    if (nested.length === 1) prefix = nested[0].slice(0, nested[0].length - "manifest.json".length);
  }
  const at = (p: string) => zip.file(prefix + p);

  const manifestFile = at("manifest.json");
  if (!manifestFile) throw new PackageError("Package is missing manifest.json");
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(await manifestFile.async("string"));
  } catch {
    throw new PackageError("manifest.json is not valid JSON");
  }
  const manifest = validateManifest(rawManifest);

  if (!at(manifest.main)) throw new PackageError(`Package is missing ${manifest.main} (manifest.main)`);
  const readmeFile = at("README.md");
  if (!readmeFile) throw new PackageError("Package is missing README.md");

  const files: Record<string, string> = {};
  let total = 0;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const rel = name.slice(prefix.length);
    if (rel.includes("..") || rel.startsWith("/")) throw new PackageError(`Unsafe path in package: ${rel}`);
    if (!TEXT_FILE_RE.test(rel)) continue;
    const text = await zip.files[name].async("string");
    total += text.length;
    if (total > MAX_TEXT_BYTES) throw new PackageError("Package contents are larger than 2 MB");
    files[rel] = text;
  }
  if (!(manifest.main in files)) throw new PackageError(`${manifest.main} could not be read as text`);

  return { manifest, files, readme: files["README.md"] ?? "" };
}

/** Builds a .ablixext from a flat map of path -> text (paths relative to the extension root). */
export async function buildPackage(files: Record<string, string>): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
}
