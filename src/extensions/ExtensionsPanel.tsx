import { useEffect, useMemo, useState } from "react";
import { BUILTIN_EXTENSIONS } from "./ExtensionManager";
import { useExtensions } from "./useExtensions";
import { extensionHost, extensionService, useHostSnapshot, useInstalledExtensions } from "./useExtensionSystem";
import { refreshMarketplace, useMarketplace } from "./useMarketplace";
import { installFromPicker, installMarketplaceRow } from "./installFlow";
import { isNewer } from "./semver";
import { PERMISSION_INFO, type InstalledExtension } from "./types";
import type { MarketplaceRow } from "./marketplace";
import { findExtensionFolders } from "./devtools";
import { ConfirmDialog } from "../desktop/components/Dialogs";
import { hasUiIcon, UiIcon } from "../icons/Icons";
import type { ProjectFile } from "../project/ProjectManager";

type Tab = "installed" | "marketplace" | "develop";

function ExtIcon({ icon }: { icon?: string }) {
  if (icon && /^(https?:|data:image\/)/i.test(icon)) return <img className="ext-icon" src={icon} alt="" referrerPolicy="no-referrer" />;
  return (
    <span className="ext-icon ext-icon-glyph">
      <UiIcon name={icon && hasUiIcon(icon) ? icon : "puzzle-piece"} size={16} />
    </span>
  );
}

function SettingsEditor({ extId }: { extId: string }) {
  const snap = useHostSnapshot();
  const settings = snap.settings.filter((s) => s.extId === extId);
  if (!settings.length) return null;
  return (
    <div className="ext-section">
      <div className="ext-section-title">Settings</div>
      {settings.map((s) => {
        const value = snap.settingValues[extId]?.[s.key] ?? s.default;
        const set = (v: unknown) => void extensionHost.setSetting(extId, s.key, v);
        return (
          <label className="ext-setting" key={s.key}>
            <span className="ext-setting-title">{s.title}</span>
            {s.description && <span className="ext-setting-desc">{s.description}</span>}
            {s.type === "boolean" && <input type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} />}
            {s.type === "string" && <input className="dialog-input" defaultValue={String(value)} onBlur={(e) => set(e.target.value)} />}
            {s.type === "number" && (
              <input className="dialog-input" type="number" defaultValue={Number(value)} onBlur={(e) => e.target.value !== "" && set(Number(e.target.value))} />
            )}
            {s.type === "enum" && (
              <select className="dialog-input" value={String(value)} onChange={(e) => set(e.target.value)}>
                {s.options?.map((o) => <option key={o}>{o}</option>)}
              </select>
            )}
          </label>
        );
      })}
    </div>
  );
}

function InstalledCard({ ext, update }: { ext: InstalledExtension; update: MarketplaceRow | null }) {
  const snap = useHostSnapshot();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const running = snap.running.includes(ext.id);
  const error = snap.errors[ext.id];
  const logs = snap.logs[ext.id] ?? [];
  const perms = ext.manifest.permissions ?? [];
  const status = !ext.enabled ? "Disabled" : error ? "Error" : running ? "Active" : "Starting…";

  return (
    <div className="ext-card" data-ext-id={ext.id}>
      <div className="ext-card-head">
        <ExtIcon icon={ext.manifest.icon} />
        <div className="ext-card-text" onClick={() => setOpen(!open)}>
          <div className="ext-card-name">
            {ext.manifest.name} <span className="ext-version">{ext.manifest.version}</span>
          </div>
          <div className="ext-card-desc">{ext.manifest.description}</div>
          <div className="ext-card-meta">
            {ext.manifest.author} · <span className={`ext-status ext-status-${status.toLowerCase()}`}>{status}</span>
          </div>
        </div>
        <label className="switch" title={ext.enabled ? "Disable" : "Enable"}>
          <input type="checkbox" checked={ext.enabled} onChange={(e) => void extensionService.setEnabled(ext.id, e.target.checked)} aria-label={`Enable ${ext.manifest.name}`} />
          <span className="switch-track" />
        </label>
      </div>
      {error && (
        <div className="ext-error">
          {error}
          <button className="btn btn-secondary ext-small" onClick={() => void extensionService.restart(ext.id)}>Restart</button>
        </div>
      )}
      <div className="ext-actions">
        {update && (
          <button className="btn btn-primary ext-small" disabled={busy} onClick={async () => { setBusy(true); await installMarketplaceRow(update); setBusy(false); }}>
            {busy ? "Updating…" : `Update to ${update.version}`}
          </button>
        )}
        <button className="btn btn-secondary ext-small" onClick={() => setOpen(!open)}>{open ? "Hide details" : "Details"}</button>
        <button className="btn btn-secondary ext-small ext-danger" onClick={() => setConfirming(true)}>Uninstall</button>
      </div>
      {open && (
        <div className="ext-details">
          <div className="ext-section">
            <div className="ext-section-title">Permissions</div>
            {perms.length ? perms.map((p) => <div key={p} className="ext-perm">{PERMISSION_INFO[p]}</div>) : <div className="ext-perm">None requested</div>}
          </div>
          <SettingsEditor extId={ext.id} />
          {logs.length > 0 && (
            <div className="ext-section">
              <div className="ext-section-title">Output</div>
              <pre className="pv-code">{logs.join("\n")}</pre>
            </div>
          )}
          <div className="ext-section">
            <div className="ext-section-title">README</div>
            <pre className="ext-readme">{ext.readme}</pre>
          </div>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title="Uninstall extension?"
          message={`"${ext.manifest.name}" and its settings will be removed.`}
          confirmLabel="Uninstall"
          onCancel={() => setConfirming(false)}
          onConfirm={() => { setConfirming(false); void extensionService.uninstall(ext.id).then(() => extensionHost.notify(`Uninstalled ${ext.manifest.name}`)); }}
        />
      )}
    </div>
  );
}

function BuiltinList() {
  const { isEnabled, setEnabled } = useExtensions();
  return (
    <>
      <div className="ext-group-title">Built-in</div>
      {BUILTIN_EXTENSIONS.map((ext) => (
        <div className="extension-row" key={ext.id}>
          <div className="extension-row-text">
            <div className="extension-row-name">{ext.name}</div>
            <div className="extension-row-desc">{ext.description}</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={isEnabled(ext.id)} onChange={(e) => setEnabled(ext.id, e.target.checked)} aria-label={ext.name} />
            <span className="switch-track" />
          </label>
        </div>
      ))}
    </>
  );
}

function MarketplaceTab() {
  const installed = useInstalledExtensions();
  const { rows, loading, error, loaded } = useMarketplace();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  void installed; // re-render when installs change so button states stay correct

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.name} ${r.description} ${r.author} ${r.category}`.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  return (
    <div>
      <div className="ext-toolbar">
        <input className="dialog-input" placeholder="Search marketplace…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-secondary ext-small" onClick={() => void refreshMarketplace()} disabled={loading} title="Refresh" aria-label="Refresh marketplace">
          <UiIcon name="refresh" size={12} />
        </button>
      </div>
      {loading && <div className="ext-empty">Loading extensions…</div>}
      {error && <div className="ext-error">{error}</div>}
      {loaded && !loading && !error && rows.length === 0 && <div className="ext-empty">No extensions have been published yet.</div>}
      {shown.map((row) => {
        const state = extensionService.marketplaceState(row);
        const have = extensionService.findByRow(row);
        return (
          <div className="ext-card" key={row.rowId} data-row-id={row.rowId}>
            <div className="ext-card-head">
              <ExtIcon icon={row.icon} />
              <div className="ext-card-text">
                <div className="ext-card-name">{row.name} <span className="ext-version">{row.version}</span></div>
                <div className="ext-card-desc">{row.description}</div>
                <div className="ext-card-meta">
                  {row.author}
                  {row.category && <> · <span className="ext-chip">{row.category}</span></>}
                  {" · "}<UiIcon name="download" size={10} /> {row.downloads}
                </div>
              </div>
            </div>
            <div className="ext-actions">
              <button
                className={`btn ${state === "installed" ? "btn-secondary" : "btn-primary"} ext-small`}
                disabled={state === "installed" || busy === row.rowId}
                onClick={async () => { setBusy(row.rowId); await installMarketplaceRow(row); setBusy(null); }}
              >
                {busy === row.rowId ? "Working…" : state === "install" ? "Install" : state === "update" ? `Update (${have?.manifest.version} → ${row.version})` : "Installed"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const API_DOCS: [string, string][] = [
  ["ablix.commands", "register(id, fn, {title}) · execute(id, ...args)"],
  ["ablix.menus", "register({location: 'editor/context' | 'explorer/context', command, title})"],
  ["ablix.keybindings", "register({key: 'ctrl+alt+h', command})"],
  ["ablix.languages", "register({id, name, extensions, rules: [{pattern, flags, token}]})"],
  ["ablix.completions", "register({languages}, {provideCompletions(doc, offset)})"],
  ["ablix.diagnostics", "register({languages}, {provideDiagnostics(doc)})"],
  ["ablix.formatters", "register({languages}, {formatDocument(doc)})"],
  ["ablix.snippets", "register(language, [{prefix, body}])"],
  ["ablix.themes", "register({id, name, colors})"],
  ["ablix.settings", "register([...]) · get(key) · onDidChange(fn)"],
  ["ablix.panels", "register({id, title, icon}) → setContent(tree)"],
  ["ablix.statusBar", "create({id, text, command}) → update(patch)"],
  ["ablix.window", "showMessage · showQuickPick · showInputBox"],
  ["ablix.editor", "getActiveDocument · replaceContent · replaceSelection · insertText  (needs \"editor\")"],
  ["ablix.workspace", "readFile · writeFile · listFiles  (needs \"workspace\")"],
];

function DevelopTab({ files, onCreate, onPackage }: { files: ProjectFile[]; onCreate: () => void; onPackage: (folder?: string) => void }) {
  const folders = findExtensionFolders(files);
  return (
    <div className="ext-develop">
      <p className="extensions-note">Build your own extension: generate a starter project, edit it, then package it into a <b>.ablixext</b> file.</p>
      <div className="ext-toolbar ext-toolbar-col">
        <button className="btn btn-primary" onClick={onCreate}><UiIcon name="wand" size={12} /> Create Extension…</button>
        <button className="btn btn-secondary" onClick={() => onPackage()} disabled={folders.length === 0}>
          <UiIcon name="package" size={12} /> Package Extension…
        </button>
      </div>
      {folders.length === 0 ? (
        <p className="extensions-note">No extension project in this workspace yet (a folder containing manifest.json).</p>
      ) : (
        <p className="extensions-note">Found: {folders.map((f) => f || "(root)").join(", ")}</p>
      )}
      <div className="ext-group-title">API reference</div>
      {API_DOCS.map(([name, sig]) => (
        <div className="ext-api" key={name}><code>{name}</code><span>{sig}</span></div>
      ))}
    </div>
  );
}

export function ExtensionsPanel({
  files, onCreateExtension, onPackageExtension,
}: {
  files: ProjectFile[];
  onCreateExtension: () => void;
  onPackageExtension: (folder?: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("installed");
  const installed = useInstalledExtensions();
  const { rows, loaded } = useMarketplace();

  useEffect(() => { if (!loaded) void refreshMarketplace(); }, [loaded]);

  const updateFor = (ext: InstalledExtension): MarketplaceRow | null => {
    if (ext.source.kind !== "marketplace") return null;
    const rowId = ext.source.rowId;
    const row = rows.find((r) => r.rowId === rowId);
    return row && isNewer(row.version, ext.manifest.version) ? row : null;
  };
  const updates = installed.filter((e) => updateFor(e)).length;

  return (
    <div className="extensions-panel">
      <div className="ablix-explorer-header">Extensions</div>
      <div className="ext-tabs" role="tablist">
        {(["installed", "marketplace", "develop"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`ext-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "installed" ? `Installed${updates ? ` (${updates} update${updates > 1 ? "s" : ""})` : ""}` : t === "marketplace" ? "Marketplace" : "Develop"}
          </button>
        ))}
      </div>

      {tab === "installed" && (
        <>
          <div className="ext-toolbar ext-toolbar-col">
            <button className="btn btn-secondary" onClick={() => void installFromPicker()}><UiIcon name="upload" size={12} /> Install from file (.ablixext)</button>
          </div>
          <div className="ext-group-title">Installed</div>
          {installed.length === 0 && <div className="ext-empty">No extensions installed. Browse the Marketplace or install a .ablixext file.</div>}
          {installed.map((ext) => <InstalledCard key={ext.id} ext={ext} update={updateFor(ext)} />)}
          <BuiltinList />
        </>
      )}
      {tab === "marketplace" && <MarketplaceTab />}
      {tab === "develop" && <DevelopTab files={files} onCreate={onCreateExtension} onPackage={onPackageExtension} />}
    </div>
  );
}
