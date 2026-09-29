import { ExtensionHost, type HostStorage, type WorkerFactory } from "./host/ExtensionHost";
import { ExtensionStore } from "./store";
import { parsePackage, PackageError, type ParsedPackage } from "./package";
import { compareVersions } from "./semver";
import { bumpDownloads, downloadPackage, type MarketplaceRow } from "./marketplace";
import type { ExtensionSource, InstalledExtension } from "./types";

/**
 * Orchestrates the extension lifecycle:
 *   package bytes -> validate manifest -> store locally -> activate in the extension host
 * plus enable / disable / uninstall / update. Framework-free so it can be tested in Node.
 */

export interface ServiceStore {
  list(): Promise<InstalledExtension[]>;
  get(id: string): Promise<InstalledExtension | undefined>;
  put(ext: InstalledExtension): Promise<void>;
  remove(id: string): Promise<void>;
}

type Listener = (installed: InstalledExtension[]) => void;

export class ExtensionService {
  readonly host: ExtensionHost;
  private store: ServiceStore;
  private installed: InstalledExtension[] = [];
  private listeners = new Set<Listener>();
  private started: Promise<void> | null = null;

  constructor(createWorker: WorkerFactory, store: ServiceStore = ExtensionStore, hostStorage: HostStorage = {
    loadSettings: (id) => ExtensionStore.loadSettings(id),
    saveSettings: (id, v) => ExtensionStore.saveSettings(id, v),
    getPref: (k) => ExtensionStore.getPref(k),
    setPref: (k, v) => ExtensionStore.setPref(k, v),
  }) {
    this.store = store;
    this.host = new ExtensionHost(createWorker, hostStorage);
  }

  /** Loads installed extensions and activates the enabled ones. Safe to call repeatedly. */
  start(): Promise<void> {
    this.started ??= (async () => {
      this.installed = await this.store.list();
      this.emit();
      await this.host.start(this.installed);
    })();
    return this.started;
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getInstalled = () => this.installed;
  private emit() {
    this.installed = [...this.installed].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
    this.listeners.forEach((l) => l(this.installed));
  }
  private async refresh() {
    this.installed = await this.store.list();
    this.emit();
  }

  find(id: string) { return this.installed.find((e) => e.id === id); }

  /** Marketplace row -> installed extension, matched by the row it was installed from. */
  findByRow(row: MarketplaceRow) {
    return this.installed.find((e) => e.source.kind === "marketplace" && e.source.rowId === row.rowId);
  }

  /** "install" | "update" | "installed" for a marketplace row. */
  marketplaceState(row: MarketplaceRow): "install" | "update" | "installed" {
    const have = this.findByRow(row);
    if (!have) return "install";
    return compareVersions(row.version, have.manifest.version) > 0 ? "update" : "installed";
  }

  /** Validates a package without installing (used to show permissions before the user confirms). */
  async inspect(data: ArrayBuffer | Uint8Array): Promise<ParsedPackage> {
    return parsePackage(data);
  }

  async installParsed(pkg: ParsedPackage, source: ExtensionSource): Promise<{ ext: InstalledExtension; previous?: InstalledExtension }> {
    const previous = await this.store.get(pkg.manifest.id);
    if (previous && previous.source.kind === "marketplace" && source.kind === "marketplace" && previous.source.rowId !== source.rowId) {
      throw new PackageError(`"${pkg.manifest.id}" is already installed from a different marketplace listing. Uninstall it first.`);
    }
    const now = Date.now();
    const ext: InstalledExtension = {
      id: pkg.manifest.id,
      manifest: pkg.manifest,
      files: pkg.files,
      readme: pkg.readme,
      enabled: previous?.enabled ?? true,
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
      source,
    };
    if (previous) await this.host.deactivate(previous.id);
    await this.store.put(ext);
    await this.refresh();
    if (ext.enabled) {
      try { await this.host.activate(ext); } catch { /* the error is recorded on the host and shown in the UI */ }
    }
    return { ext, previous };
  }

  /** Install from raw .ablixext bytes (local file, or downloaded from the marketplace). */
  async installPackage(data: ArrayBuffer | Uint8Array, source: ExtensionSource = { kind: "local" }) {
    return this.installParsed(await parsePackage(data), source);
  }

  /** Full marketplace flow: Storage download (by fileId) -> validate -> install -> activate. */
  async installFromMarketplace(row: MarketplaceRow) {
    const pkg = await this.downloadAndInspect(row);
    return this.commitMarketplace(pkg, row);
  }

  /** Step 1 of the marketplace flow: fileId -> Appwrite Storage -> bytes -> validated manifest. */
  async downloadAndInspect(row: MarketplaceRow): Promise<ParsedPackage> {
    return parsePackage(await downloadPackage(row));
  }

  /** Step 2: install the validated package and record the download. */
  async commitMarketplace(pkg: ParsedPackage, row: MarketplaceRow) {
    const result = await this.installParsed(pkg, { kind: "marketplace", rowId: row.rowId, fileId: row.fileId });
    void bumpDownloads(row);
    return result;
  }

  async setEnabled(id: string, enabled: boolean) {
    const ext = await this.store.get(id);
    if (!ext) return;
    const next = { ...ext, enabled };
    await this.store.put(next);
    await this.refresh();
    if (enabled) {
      try { await this.host.activate(next); } catch { /* surfaced via host errors */ }
    } else {
      await this.host.deactivate(id);
    }
  }

  async uninstall(id: string) {
    await this.host.deactivate(id);
    await this.store.remove(id);
    await this.refresh();
  }

  /** Re-runs an extension that crashed or was stopped. */
  async restart(id: string) {
    const ext = await this.store.get(id);
    if (ext?.enabled) await this.host.restart(ext).catch(() => undefined);
  }
}
