import { useRef } from "react";
import { AppIcon } from "../../icons/Icons";

export function DesktopIcon({
  label,
  selected,
  onSelect,
  onOpen,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const lastTapRef = useRef(0);

  return (
    <div
      className={`desktop-app-icon${selected ? " selected" : ""}`}
      style={{ left: 24, top: 24 }}
      onPointerDown={onSelect}
      onPointerUp={() => {
        const now = Date.now();
        if (now - lastTapRef.current < 350) onOpen();
        lastTapRef.current = now;
      }}
      onDoubleClick={onOpen}
    >
      <div className="desktop-app-icon-glyph">
        <AppIcon app="ablix" size={44} />
      </div>
      <div className="desktop-folder-label">{label}</div>
    </div>
  );
}
