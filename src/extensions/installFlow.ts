import { extensionHost, extensionService } from "./useExtensionSystem";
import { PackageError, type ParsedPackage } from "./package";
import { PERMISSION_INFO } from "./types";
import type { MarketplaceRow } from "./marketplace";
import { pickFile } from "./download";

/** UI-facing install flows: validate -> show permissions -> install -> report. */

async function confirm(pkg: ParsedPackage): Promise<boolean> {
  const perms = pkg.manifest.permissions ?? [];
  if (perms.length === 0) return true;
  const grants = perms.map((p) => PERMISSION_INFO[p]).join("; ");
  const choice = await extensionHost.showQuickPick(
    [
      { label: "Install", detail: `Allows: ${grants}`, value: true },
      { label: "Cancel", value: false },
    ],
    { title: `Install "${pkg.manifest.name}" ${pkg.manifest.version} by ${pkg.manifest.author}?` }
  );
  return choice?.value === true;
}

const errText = (e: unknown) => (e instanceof PackageError || e instanceof Error ? e.message : String(e));

function report(result: Awaited<ReturnType<typeof extensionService.installParsed>>) {
  const { ext, previous } = result;
  const name = ext.manifest.name;
  const failed = extensionHost.getSnapshot().errors[ext.id];
  if (failed) extensionHost.notify(`${name} was installed but failed to start: ${failed}`, "warning");
  else if (previous) {
    extensionHost.notify(
      previous.manifest.version === ext.manifest.version
        ? `Reinstalled ${name} ${ext.manifest.version}`
        : `Updated ${name} ${previous.manifest.version} → ${ext.manifest.version}`
    );
  } else extensionHost.notify(`Installed ${name} ${ext.manifest.version}`);
}

export async function installBytes(bytes: ArrayBuffer | Uint8Array) {
  try {
    const pkg = await extensionService.inspect(bytes);
    if (!(await confirm(pkg))) return null;
    const result = await extensionService.installParsed(pkg, { kind: "local" });
    report(result);
    return result.ext;
  } catch (e) {
    extensionHost.notify(`Install failed: ${errText(e)}`, "error");
    return null;
  }
}

export async function installLocalFile(file: File) {
  return installBytes(await file.arrayBuffer());
}

export async function installFromPicker() {
  const file = await pickFile(".ablixext,application/zip");
  return file ? installLocalFile(file) : null;
}

export async function installMarketplaceRow(row: MarketplaceRow) {
  try {
    const pkg = await extensionService.downloadAndInspect(row);
    if (!(await confirm(pkg))) return null;
    const result = await extensionService.commitMarketplace(pkg, row);
    report(result);
    return result.ext;
  } catch (e) {
    extensionHost.notify(`Install failed: ${errText(e)}`, "error");
    return null;
  }
}
