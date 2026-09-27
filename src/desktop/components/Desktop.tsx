import { useEffect, useRef, useState } from "react";
import { DesktopFolder } from "./DesktopFolder";
import { DesktopIcon } from "./DesktopIcon";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { ConfirmDialog, PromptDialog } from "./Dialogs";
import { ProjectManager, type ProjectRecord } from "../../project/ProjectManager";

const LONG_PRESS_MS = 500;

export function Desktop({
  onOpenInAblix,
}: {
  onOpenInAblix: (projectId: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [creating, setCreating] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<ProjectRecord | null>(null);
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null);
  const desktopRef = useRef<HTMLDivElement>(null);
  const longPressState = useRef<{ timer: number; x: number; y: number } | null>(null);
  const persistTimers = useRef<Record<string, number>>({});

  const schedulePersist = (id: string, x: number, y: number) => {
    if (persistTimers.current[id]) window.clearTimeout(persistTimers.current[id]);
    persistTimers.current[id] = window.setTimeout(() => {
      ProjectManager.updatePosition(id, { x, y });
    }, 200);
  };

  useEffect(() => {
    ProjectManager.list().then(setProjects);
  }, []);

  const refresh = () => ProjectManager.list().then(setProjects);

  const openEmptyDesktopMenu = (x: number, y: number) => {
    setSelectedId(null);
    setMenu({
      x,
      y,
      items: [
        { label: "Create Folder", icon: "new-folder", onSelect: () => setCreating({ x, y }) },
        { label: "Create File", icon: "new-file", onSelect: () => {} },
        { label: "Refresh", icon: "refresh", onSelect: refresh },
      ],
    });
  };

  const openFolderMenu = (project: ProjectRecord, x: number, y: number) => {
    setMenu({
      x,
      y,
      items: [
        { label: "Open", icon: "open", onSelect: () => onOpenInAblix(project.id) },
        { label: "Open with Ablix", icon: "open", onSelect: () => onOpenInAblix(project.id) },
        { label: "Rename", icon: "rename", onSelect: () => setRenaming(project) },
        {
          label: "Delete",
          icon: "trash",
          danger: true,
          onSelect: () => setDeleting(project),
        },
      ],
    });
  };

  const handleDesktopContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (e.target !== desktopRef.current) return; // clicked a child, handled there
    openEmptyDesktopMenu(e.clientX, e.clientY);
  };

  const handleDesktopPointerDown = (e: React.PointerEvent) => {
    if (e.target !== desktopRef.current) return;
    const { clientX, clientY } = e;
    const timer = window.setTimeout(() => openEmptyDesktopMenu(clientX, clientY), LONG_PRESS_MS);
    longPressState.current = { timer, x: clientX, y: clientY };
  };
  const clearLongPress = () => {
    if (longPressState.current) window.clearTimeout(longPressState.current.timer);
    longPressState.current = null;
  };

  return (
    <div
      ref={desktopRef}
      className="desktop-surface"
      onContextMenu={handleDesktopContextMenu}
      onPointerDown={handleDesktopPointerDown}
      onPointerMove={clearLongPress}
      onPointerUp={clearLongPress}
      onClick={(e) => {
        if (e.target === desktopRef.current) setSelectedId(null);
      }}
    >
      <DesktopIcon
        label="Ablix"
        selected={selectedId === "__ablix__"}
        onSelect={() => setSelectedId("__ablix__")}
        onOpen={() => onOpenInAblix("")}
      />

      {projects.map((p) => (
        <DesktopFolder
          key={p.id}
          project={p}
          selected={selectedId === p.id}
          onSelect={setSelectedId}
          onOpen={onOpenInAblix}
          onMove={(id, x, y) => {
            setProjects((prev) =>
              prev.map((proj) => (proj.id === id ? { ...proj, position: { x, y } } : proj))
            );
            schedulePersist(id, x, y);
          }}
          onContextMenu={(x, y) => openFolderMenu(p, x, y)}
        />
      ))}

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />

      {creating && (
        <PromptDialog
          title="Create Folder"
          label="Name:"
          defaultValue="New Folder"
          onCancel={() => setCreating(null)}
          onConfirm={async (name) => {
            const record = await ProjectManager.create(name, {
              x: Math.max(8, creating.x - 40),
              y: Math.max(8, creating.y - 40),
            });
            setProjects((prev) => [...prev, record]);
            setCreating(null);
          }}
        />
      )}

      {renaming && (
        <PromptDialog
          title="Rename"
          label="Name:"
          defaultValue={renaming.name}
          confirmLabel="Rename"
          onCancel={() => setRenaming(null)}
          onConfirm={async (name) => {
            await ProjectManager.rename(renaming.id, name);
            setRenaming(null);
            refresh();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete Folder?"
          message={`Are you sure you want to delete "${deleting.name}"?`}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await ProjectManager.remove(deleting.id);
            setProjects((prev) => prev.filter((p) => p.id !== deleting.id));
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}


