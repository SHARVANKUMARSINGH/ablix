import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Explorer } from "./Explorer";
import { TabBar, type EditorTab } from "./TabBar";
import { CodeEditor, type EditorHandle } from "./CodeEditor";
import { ActivityBar, panelViewId, type SidebarView } from "./ActivityBar";
import { langFromFilename, languageLabel } from "./syntaxHighlight";
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from "../desktop/components/ContextMenu";
import { extensionHost, useHostSnapshot } from "../extensions/useExtensionSystem";
import { PanelView } from "../extensions/ui/PanelView";
import { StatusBar } from "../extensions/ui/StatusBar";
import { CreateExtensionDialog, PackageResultDialog } from "../extensions/ui/DevDialogs";
import { findExtensionFolders, packageExtensionFolder, scaffoldExtension, type NewExtensionOptions } from "../extensions/devtools";
import { downloadBytes } from "../extensions/download";
import { installBytes } from "../extensions/installFlow";
import type { CompletionItem, Diagnostic, EditorDocument } from "../extensions/types";
import { ResizeHandle } from "./ResizeHandle";
import { ExtensionsPanel } from "../extensions/ExtensionsPanel";
import { useExtensions } from "../extensions/useExtensions";
import { UiIcon } from "../icons/Icons";
import { ProjectManager, type ProjectRecord } from "../project/ProjectManager";
import { syncFileToContainer } from "./webcontainer";
import { downloadProjectZip } from "../project/downloadProjectZip";

// Code-split: xterm + @webcontainer/api only load once the terminal/preview
// are actually opened, not as part of the main app bundle.
const TerminalPanel = lazy(() => import("./Terminal"));
const PreviewPane = lazy(() => import("./PreviewPane"));

const EXPLORER_MIN = 160;
const EXPLORER_MAX = 420;
const TERMINAL_MIN = 120;
const TERMINAL_MAX = 480;
const PREVIEW_MIN = 220;
const PREVIEW_MAX = 640;

function trimTrailingWhitespace(content: string) {
  return content
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

export function IdeWorkspace({
  project,
  onProjectChanged,
}: {
  project: ProjectRecord;
  onProjectChanged: (next: ProjectRecord) => void;
}) {
  const { isEnabled } = useExtensions();
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sidebarView, setSidebarView] = useState<SidebarView>("explorer");
  const snap = useHostSnapshot();
  const editorRef = useRef<EditorHandle>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [creatingExt, setCreatingExt] = useState(false);
  const [packaged, setPackaged] = useState<Awaited<ReturnType<typeof packageExtensionFolder>> | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalEverOpened, setTerminalEverOpened] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewEverOpened, setPreviewEverOpened] = useState(false);

  const [explorerWidth, setExplorerWidth] = useState(210);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [previewWidth, setPreviewWidth] = useState(340);

  const [zipping, setZipping] = useState(false);

  const activeFile = useMemo(
    () => project.files.find((f) => f.path === activePath) ?? null,
    [project.files, activePath]
  );

  const openFile = (path: string) => {
    setTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, dirty: false }]));
    setActivePath(path);
  };

  const closeTab = (path: string) => {
    setTabs((prev) => prev.filter((t) => t.path !== path));
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    if (activePath === path) {
      const remaining = tabs.filter((t) => t.path !== path);
      setActivePath(remaining.length ? remaining[remaining.length - 1].path : null);
    }
  };

  const handleChange = (path: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [path]: value }));
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, dirty: true } : t)));
  };

  const handleSave = async (path: string) => {
    let content = drafts[path];
    if (content === undefined) return;
    if (isEnabled("trim-trailing-whitespace")) content = trimTrailingWhitespace(content);

    const updated = await ProjectManager.writeFile(project.id, path, content);
    if (updated) onProjectChanged(updated);
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, dirty: false } : t)));
    setDrafts((prev) => ({ ...prev, [path]: content }));
    syncFileToContainer(path, content); // best-effort, no-op if no container booted yet
  };

  const refreshAfter = async (op: Promise<ProjectRecord | undefined>) => {
    const updated = await op;
    if (updated) onProjectChanged(updated);
  };

  const currentValue = activePath ? drafts[activePath] ?? activeFile?.content ?? "" : "";
  const language = activePath ? langFromFilename(activePath, snap.languages) : null;

  /* ---------------- extension system wiring ---------------- */
  const live = useRef({ project, drafts, activePath, currentValue, language, handleChange, onProjectChanged, openFile });
  live.current = { project, drafts, activePath, currentValue, language, handleChange, onProjectChanged, openFile };

  const docFor = useCallback((): EditorDocument | null => {
    const l = live.current;
    if (!l.activePath || !l.language) return null;
    return { path: l.activePath, language: l.language, text: l.currentValue, selection: editorRef.current?.getSelection() };
  }, []);

  // What extensions may reach (each call is additionally permission-checked by the host).
  useEffect(() => {
    extensionHost.setBridge({
      getActiveDocument: () => docFor(),
      replaceContent: (text) => { const l = live.current; if (l.activePath) l.handleChange(l.activePath, text); },
      replaceSelection: (text) => editorRef.current?.replaceSelection(text),
      insertText: (text) => editorRef.current?.insertText(text),
      readFile: (path) => {
        const l = live.current;
        if (path in l.drafts) return l.drafts[path];
        return l.project.files.find((f) => f.path === path)?.content ?? null;
      },
      writeFile: async (path, content) => {
        const l = live.current;
        const updated = await ProjectManager.writeFile(l.project.id, path, content);
        if (updated) l.onProjectChanged(updated);
      },
      listFiles: () => live.current.project.files.filter((f) => !f.path.endsWith(".keep")).map((f) => f.path),
    });
    return () => extensionHost.setBridge(null);
  }, [docFor]);

  const requestCompletions = useCallback(async (offset: number): Promise<CompletionItem[]> => {
    const doc = docFor();
    return doc ? extensionHost.provideCompletions(doc, offset) : [];
  }, [docFor]);

  // Diagnostics from extension providers (debounced).
  const diagKey = snap.diagnostics.map((p) => `${p.extId}:${p.providerId}`).join(",");
  const diagSeq = useRef(0);
  useEffect(() => {
    const seq = ++diagSeq.current;
    if (!activePath || !language || !diagKey) { setDiagnostics((d) => (d.length ? [] : d)); return; }
    const t = setTimeout(async () => {
      const d = await extensionHost.provideDiagnostics({ path: activePath, language, text: currentValue });
      if (seq === diagSeq.current) setDiagnostics(d);
    }, 400);
    return () => clearTimeout(t);
  }, [activePath, language, currentValue, diagKey]);

  const formatActive = useCallback(async () => {
    const doc = docFor();
    if (!doc) throw new Error("Open a file first");
    const out = await extensionHost.formatDocument(doc);
    if (out === null) throw new Error(`No formatter is registered for ${languageLabel(doc.language)}`);
    live.current.handleChange(doc.path, out);
    extensionHost.notify("Document formatted");
  }, [docFor]);

  const showProblems = useCallback(() => {
    void (async () => {
      const list = diagnosticsRef.current;
      if (!list.length) { extensionHost.notify("No problems in the active file"); return; }
      const pick = await extensionHost.showQuickPick(
        list.map((d) => ({ label: `${d.severity === "error" ? "Error" : d.severity === "warning" ? "Warning" : "Info"}: ${d.message}`, detail: `Line ${d.line}${d.column ? `, col ${d.column}` : ""}`, value: d })),
        { title: "Problems" }
      );
      const d = pick?.value as Diagnostic | undefined;
      if (d) editorRef.current?.goTo(d.line, d.column);
    })();
  }, []);
  const diagnosticsRef = useRef(diagnostics);
  diagnosticsRef.current = diagnostics;

  const startPackage = useCallback(async (folder?: string) => {
    try {
      const files = live.current.project.files;
      const folders = findExtensionFolders(files);
      if (folders.length === 0) throw new Error("No extension project found (a folder with manifest.json)");
      let target = folder;
      if (target === undefined) {
        if (folders.length === 1) target = folders[0];
        else {
          const pick = await extensionHost.showQuickPick(folders.map((f) => ({ label: f || "(project root)", value: f })), { title: "Package which extension?" });
          if (!pick) return;
          target = pick.value as string;
        }
      }
      setPackaged(await packageExtensionFolder(files, target));
    } catch (e) {
      extensionHost.notify(`Package failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, []);

  const createExtension = useCallback(async (o: NewExtensionOptions) => {
    const l = live.current;
    let latest = undefined as Awaited<ReturnType<typeof ProjectManager.createFile>>;
    for (const f of scaffoldExtension(o)) latest = await ProjectManager.createFile(l.project.id, f.path, f.content);
    if (latest) l.onProjectChanged(latest);
    setCreatingExt(false);
    l.openFile(`${o.folder}/extension.js`);
    setSidebarView("explorer");
    extensionHost.notify(`Created ${o.folder}/ — edit extension.js, then run Package Extension`);
  }, []);

  useEffect(() => {
    const cmds: [string, string, () => unknown][] = [
      ["ablix.formatDocument", "Format Document", () => formatActive()],
      ["ablix.createExtension", "Create Extension…", () => setCreatingExt(true)],
      ["ablix.packageExtension", "Package Extension…", () => startPackage()],
      ["ablix.showProblems", "Show Problems", () => showProblems()],
      ["ablix.showExtensions", "Show Extensions", () => setSidebarView("extensions")],
    ];
    for (const [id, title, run] of cmds) extensionHost.registerBuiltinCommand(id, title, run, "Ablix");
    return () => cmds.forEach(([id]) => extensionHost.unregisterBuiltinCommand(id));
  }, [formatActive, startPackage, showProblems]);

  // If the active extension panel goes away (disabled/uninstalled), fall back to the Explorer.
  const view = sidebarView.startsWith("panel:") && !snap.panels.some((p) => panelViewId(p) === sidebarView) ? "explorer" : sidebarView;
  const activePanel = snap.panels.find((p) => panelViewId(p) === view) ?? null;

  const runCmd = (command: string, ...args: unknown[]) =>
    extensionHost.executeCommand(command, ...args).catch((e) => extensionHost.notify(String(e.message ?? e), "error"));

  const editorMenu = (x: number, y: number) => {
    const items: ContextMenuItem[] = snap.menus
      .filter((m) => m.location === "editor/context" && (!m.languages?.length || (language && m.languages.includes(language))))
      .map((m) => ({ label: m.title, icon: "puzzle-piece", onSelect: () => void runCmd(m.command) }));
    if (language && extensionHost.hasFormatter(language)) items.unshift({ label: "Format Document", icon: "wand", onSelect: () => void runCmd("ablix.formatDocument") });
    if (!items.length) return false;
    setCtxMenu({ x, y, items });
    return true;
  };

  const explorerExtras = (node: { path: string; isFolder: boolean } | null): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (node?.isFolder && project.files.some((f) => f.path === `${node.path}/manifest.json`)) {
      items.push({ label: "Package Extension", icon: "package", onSelect: () => void startPackage(node.path) });
    }
    for (const m of snap.menus.filter((x) => x.location === "explorer/context")) {
      items.push({ label: m.title, icon: "puzzle-piece", onSelect: () => void runCmd(m.command, node?.path ?? null) });
    }
    return items;
  };

  const openTerminal = () => {
    setTerminalEverOpened(true);
    setTerminalOpen(true);
  };
  const openPreview = () => {
    setPreviewEverOpened(true);
    setPreviewOpen(true);
  };

  return (
    <div className="ide-workspace">
      <ActivityBar view={view} onChange={setSidebarView} panels={snap.panels} />

      <div className="ide-sidebar" style={{ width: view === "extensions" ? Math.max(explorerWidth, 300) : explorerWidth }}>
        {view === "explorer" ? (
          <Explorer
            files={project.files}
            activePath={activePath}
            onOpenFile={openFile}
            onCreateFile={(path) => refreshAfter(ProjectManager.createFile(project.id, path, ""))}
            onCreateFolder={(path) => refreshAfter(ProjectManager.createFolder(project.id, path))}
            onRename={(oldPath, newPath) =>
              refreshAfter(ProjectManager.renamePath(project.id, oldPath, newPath))
            }
            onDelete={(path, isFolder) =>
              refreshAfter(ProjectManager.deletePath(project.id, path, isFolder))
            }
            extraMenuItems={explorerExtras}
          />
        ) : activePanel ? (
          <PanelView panel={activePanel} />
        ) : (
          <ExtensionsPanel
            files={project.files}
            onCreateExtension={() => setCreatingExt(true)}
            onPackageExtension={(folder) => void startPackage(folder)}
          />
        )}
      </div>
      <ResizeHandle
        direction="horizontal"
        onResize={(dx) =>
          setExplorerWidth((w) => Math.min(EXPLORER_MAX, Math.max(EXPLORER_MIN, w + dx)))
        }
      />

      <div className="ide-main">
        <div className="ide-main-toprow">
          <TabBar tabs={tabs} activePath={activePath} onSelect={setActivePath} onClose={closeTab} />
          <div className="ide-panel-toggles">
            <button title="Command Palette (Ctrl+Shift+P)" aria-label="Command Palette" onClick={() => void runCmd("ablix.commandPalette")}>
              <UiIcon name="command" size={14} />
            </button>
            <button
              className={zipping ? "active" : ""}
              disabled={zipping}
              title="Download project as ZIP"
              onClick={async () => {
                setZipping(true);
                try {
                  await downloadProjectZip(project);
                } finally {
                  setZipping(false);
                }
              }}
            >
              <UiIcon name="download" size={14} />
            </button>
            <button
              className={terminalOpen ? "active" : ""}
              onClick={() => (terminalOpen ? setTerminalOpen(false) : openTerminal())}
              title="Toggle terminal"
            >
              <UiIcon name="terminal" size={14} />
            </button>
            <button
              className={previewOpen ? "active" : ""}
              onClick={() => (previewOpen ? setPreviewOpen(false) : openPreview())}
              title="Toggle preview"
            >
              <UiIcon name="eye" size={14} />
            </button>
          </div>
        </div>

        <div className="ide-editor-row">
          <div className="ide-editor-column">
            <div className="ide-editor-area">
              {activePath && activeFile ? (
                <CodeEditor
                  ref={editorRef}
                  filename={activePath}
                  value={currentValue}
                  onChange={(v) => handleChange(activePath, v)}
                  onSave={() => handleSave(activePath)}
                  wordWrap={isEnabled("word-wrap")}
                  customLanguages={snap.languages}
                  diagnostics={diagnostics}
                  requestCompletions={requestCompletions}
                  onContextMenu={editorMenu}
                />
              ) : (
                <div className="ablix-editor-placeholder">
                  <p>Select a file from the Explorer to start editing.</p>
                </div>
              )}
            </div>

            {terminalEverOpened && (
              <>
                <ResizeHandle
                  direction="vertical"
                  onResize={(_dx, dy) =>
                    setTerminalHeight((h) =>
                      Math.min(TERMINAL_MAX, Math.max(TERMINAL_MIN, h - dy))
                    )
                  }
                />
                <div style={{ height: terminalHeight, flexShrink: 0 }}>
                  <Suspense fallback={<div className="panel-loading">Loading terminal…</div>}>
                    <TerminalPanel
                      projectId={project.id}
                      files={project.files}
                      visible={terminalOpen}
                      onClose={() => setTerminalOpen(false)}
                      onProjectChanged={onProjectChanged}
                    />
                  </Suspense>
                </div>
              </>
            )}
          </div>

          {previewEverOpened && (
            <>
              <ResizeHandle
                direction="horizontal"
                onResize={(dx) =>
                  setPreviewWidth((w) => Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, w - dx)))
                }
              />
              <div style={{ width: previewWidth, flexShrink: 0 }}>
                <Suspense fallback={<div className="panel-loading">Loading preview…</div>}>
                  <PreviewPane visible={previewOpen} onClose={() => setPreviewOpen(false)} />
                </Suspense>
              </div>
            </>
          )}
        </div>
        <StatusBar
          languageName={language ? languageLabel(language, snap.languages) : null}
          diagnostics={diagnostics}
          items={snap.statusItems}
          onShowProblems={showProblems}
        />
      </div>

      <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
      {creatingExt && (
        <CreateExtensionDialog
          existingFolders={project.files.map((f) => f.path.split("/")[0]).filter((f, i, a) => a.indexOf(f) === i)}
          onCancel={() => setCreatingExt(false)}
          onCreate={(o) => void createExtension(o)}
        />
      )}
      {packaged && (
        <PackageResultDialog
          filename={packaged.filename}
          size={packaged.bytes.length}
          name={packaged.manifest.name}
          version={packaged.manifest.version}
          onClose={() => setPackaged(null)}
          onDownload={() => downloadBytes(packaged.filename, packaged.bytes, "application/zip")}
          onInstall={async () => {
            const bytes = packaged.bytes;
            setPackaged(null);
            await installBytes(bytes);
            setSidebarView("extensions");
          }}
        />
      )}
    </div>
  );
}
