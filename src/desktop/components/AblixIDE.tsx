import { useRef, useState } from "react";
import { UiIcon } from "../../icons/Icons";
import type { ProjectRecord } from "../../project/ProjectManager";
import type { WindowState } from "../useWindowManager";
import { IdeWorkspace } from "../../ide/IdeWorkspace";

export function AblixIDE({
  window: win,
  project,
  onFocus,
  onMinimize,
  onClose,
  onProjectChanged,
}: {
  window: WindowState;
  project: ProjectRecord | null;
  onFocus: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onProjectChanged: (next: ProjectRecord) => void;
}) {
  const [pos, setPos] = useState({ x: 80, y: 48 });
  const dragRef = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(
    null
  );

  // "closed" fully unmounts (kills terminal/WebContainer state on purpose).
  // "minimized" stays mounted but hidden, so the running shell, editor drafts,
  // and WebContainer boot all survive being minimized and refocused.
  if (win.status === "closed") return null;

  const handleTitleDown = (e: React.PointerEvent) => {
    onFocus();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
  };
  const handleTitleMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    setPos({ x: d.ox + (e.clientX - d.sx), y: Math.max(0, d.oy + (e.clientY - d.sy)) });
  };
  const handleTitleUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      className={`ablix-window${win.focused ? " focused" : ""}${
        win.status === "minimized" ? " minimized" : ""
      }`}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onFocus}
    >
      <div
        className="ablix-titlebar"
        onPointerDown={handleTitleDown}
        onPointerMove={handleTitleMove}
        onPointerUp={handleTitleUp}
        onPointerCancel={handleTitleUp}
      >
        <div className="ablix-titlebar-title">
          <span className="ablix-brand">A</span>
          <span>Ablix{project ? ` — ${project.name}` : ""}</span>
        </div>
        <div className="ablix-titlebar-controls">
          <button aria-label="Minimize" onClick={onMinimize}>
            <UiIcon name="minimize" size={13} />
          </button>
          <button aria-label="Close" onClick={onClose}>
            <UiIcon name="close" size={13} />
          </button>
        </div>
      </div>

      <div className="ablix-body">
        {!project ? (
          <div className="ablix-empty-state">
            <UiIcon name="folder-open" size={40} />
            <h3>No Project Open</h3>
            <p>Create a project or open a folder to begin.</p>
          </div>
        ) : (
          <IdeWorkspace project={project} onProjectChanged={onProjectChanged} />
        )}
      </div>
    </div>
  );
}
