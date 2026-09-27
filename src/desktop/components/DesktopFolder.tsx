import React, { useRef, useState } from "react";
import { FileIcon } from "../../icons/Icons";
import type { ProjectRecord } from "../../project/ProjectManager";

const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD_PX = 6;

export function DesktopFolder({
  project,
  selected,
  onSelect,
  onOpen,
  onMove,
  onContextMenu,
}: {
  project: ProjectRecord;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onContextMenu: (clientX: number, clientY: number) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    longPressTimer: number | null;
  } | null>(null);

  const clearLongPress = () => {
    if (dragState.current?.longPressTimer) {
      window.clearTimeout(dragState.current.longPressTimer);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const longPressTimer = window.setTimeout(() => {
      if (dragState.current && !dragState.current.moved) {
        onSelect(project.id);
        onContextMenu(e.clientX, e.clientY);
      }
    }, LONG_PRESS_MS);

    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: project.position.x,
      originY: project.position.y,
      moved: false,
      longPressTimer,
    };
    onSelect(project.id);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      ds.moved = true;
      setDragging(true);
      clearLongPress();
    }
    if (ds.moved) {
      onMove(project.id, ds.originX + dx, ds.originY + dy);
    }
  };

  const handlePointerUp = () => {
    const ds = dragState.current;
    clearLongPress();
    setDragging(false);
    if (ds && !ds.moved) {
      // A clean tap/click that didn't turn into a drag or long-press: selection
      // already happened on pointerdown; double click/tap handled separately.
    }
    dragState.current = null;
  };

  const lastTapRef = useRef(0);
  const handlePointerUpForTap = () => {
    handlePointerUp();
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      onOpen(project.id);
    }
    lastTapRef.current = now;
  };

  return (
    <div
      ref={elRef}
      className={`desktop-folder${selected ? " selected" : ""}${dragging ? " dragging" : ""}`}
      style={{ left: project.position.x, top: project.position.y }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpForTap}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => onOpen(project.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect(project.id);
        onContextMenu(e.clientX, e.clientY);
      }}
    >
      <div className="desktop-folder-icon">
        <FileIcon filename="" isFolder size={40} />
      </div>
      <div className="desktop-folder-label">{project.name}</div>
    </div>
  );
}
