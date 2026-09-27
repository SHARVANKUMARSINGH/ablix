import type { ProjectRecord } from "./ProjectManager";

function sanitizeZipFilename(name: string) {
  return name.trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "project";
}

/**
 * Zips every real file in the project (skipping the ".keep" empty-folder
 * markers, which exist only so empty folders survive in IndexedDB) and
 * triggers a browser download. Runs entirely client-side via JSZip — no
 * server involved, so this works the same on Cloudflare Pages as anywhere
 * else.
 */
export async function downloadProjectZip(project: ProjectRecord) {
  const { default: JSZip } = await import("jszip"); // lazy: keep it out of the main bundle
  const zip = new JSZip();
  for (const file of project.files) {
    if (file.path.endsWith("/.keep")) continue;
    zip.file(file.path, file.content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeZipFilename(project.name)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
