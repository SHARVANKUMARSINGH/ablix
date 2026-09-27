import { useRef } from "react";

export function ResizeHandle({
  direction,
  onResize,
}: {
  direction: "horizontal" | "vertical";
  /** Called with the raw pointer delta (px) on every move; caller clamps. */
  onResize: (deltaX: number, deltaY: number) => void;
}) {
  const last = useRef<{ id: number; x: number; y: number } | null>(null);

  const handleDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    last.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const handleMove = (e: React.PointerEvent) => {
    const l = last.current;
    if (!l || l.id !== e.pointerId) return;
    const dx = e.clientX - l.x;
    const dy = e.clientY - l.y;
    last.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    onResize(dx, dy);
  };
  const handleUp = () => {
    last.current = null;
  };

  return (
    <div
      className={`resize-handle resize-handle-${direction}`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    />
  );
}
