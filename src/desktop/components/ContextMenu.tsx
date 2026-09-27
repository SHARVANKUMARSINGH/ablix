import { useEffect, useRef } from "react";
import { UiIcon } from "../../icons/Icons";

export interface ContextMenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  onSelect: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export function ContextMenu({
  menu,
  onClose,
}: {
  menu: ContextMenuState | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) {
        return;
      }
      onClose();
    };
    // pointerdown covers mouse + touch; keep the escape hatch too
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("scroll", onClose, true);
    const escHandler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", escHandler);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("keydown", escHandler);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // Clamp so the menu never renders off-screen (important on small/touch viewports).
  const width = 220;
  const estHeight = menu.items.length * 36 + 8;
  const x = Math.min(menu.x, window.innerWidth - width - 8);
  const y = Math.min(menu.y, window.innerHeight - estHeight - 8);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: Math.max(4, x), top: Math.max(4, y), width }}
      role="menu"
    >
      {menu.items.map((item, i) => (
        <button
          key={i}
          className={`context-menu-item${item.danger ? " danger" : ""}`}
          role="menuitem"
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.icon && <UiIcon name={item.icon} size={14} />}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
