import { lazy, Suspense, useMemo, useState } from "react";
import { Explorer } from "./Explorer";
import { TabBar, type EditorTab } from "./TabBar";
import { CodeEditor } from "./CodeEditor";
import { ActivityBar, type SidebarView } from "./ActivityBar";
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
      <ActivityBar view={sidebarView} onChange={setSidebarView} />

      <div className="ide-sidebar" style={{ width: explorerWidth }}>
        {sidebarView === "explorer" ? (
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
          />
        ) : (
          <ExtensionsPanel />
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
                  filename={activePath}
                  value={currentValue}
                  onChange={(v) => handleChange(activePath, v)}
                  onSave={() => handleSave(activePath)}
                  wordWrap={isEnabled("word-wrap")}
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
      </div>
    </div>
  );
}
