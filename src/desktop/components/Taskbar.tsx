import { useEffect, useState } from "react";
import { AppIcon, UiIcon } from "../../icons/Icons";
import type { WindowState } from "../useWindowManager";
import { useFullscreen } from "../useFullscreen";

export function Taskbar({
  ablix,
  onToggleAblix,
}: {
  ablix: WindowState;
  onToggleAblix: () => void;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 15);
    return () => clearInterval(t);
  }, []);

  const { isFullscreen, supported, toggle } = useFullscreen();

  return (
    <div className="taskbar">
      <button className="taskbar-launcher" aria-label="Applications">
        <UiIcon name="start" size={18} />
      </button>

      <div className="taskbar-pinned">
        <button
          className={`taskbar-app${ablix.status !== "closed" ? " running" : ""}${
            ablix.focused ? " focused" : ""
          }`}
          onClick={onToggleAblix}
          aria-label="Ablix"
          title="Ablix"
        >
          <AppIcon app="ablix" size={26} />
          {ablix.status !== "closed" && <span className="taskbar-app-dot" />}
        </button>
      </div>

      <div className="taskbar-spacer" />

      <div className="taskbar-system">
        {supported && (
          <button
            className="taskbar-system-btn"
            onClick={toggle}
            aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
            title={isFullscreen ? "Exit full screen" : "Enter full screen"}
          >
            <UiIcon name={isFullscreen ? "compress" : "expand"} size={14} />
          </button>
        )}
        <UiIcon name="clock" size={14} />
        <span className="taskbar-clock">
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}
