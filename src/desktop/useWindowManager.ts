import { useCallback, useState } from "react";

export type WindowStatus = "closed" | "open" | "minimized";

export interface WindowState {
  status: WindowStatus;
  focused: boolean;
  activeProjectId: string | null;
}

export function useWindowManager() {
  const [ablix, setAblix] = useState<WindowState>({
    status: "closed",
    focused: false,
    activeProjectId: null,
  });

  const openAblix = useCallback((projectId: string | null = null) => {
    setAblix((prev) => ({
      status: "open",
      focused: true,
      // Only replace the active project if one was explicitly requested;
      // clicking the taskbar/launcher icon just re-focuses the existing session.
      activeProjectId: projectId ?? prev.activeProjectId,
    }));
  }, []);

  const focusAblix = useCallback(() => {
    setAblix((prev) => ({ ...prev, status: "open", focused: true }));
  }, []);

  const minimizeAblix = useCallback(() => {
    setAblix((prev) => ({ ...prev, status: "minimized", focused: false }));
  }, []);

  const closeAblix = useCallback(() => {
    setAblix({ status: "closed", focused: false, activeProjectId: null });
  }, []);

  // Clicking the taskbar/launcher icon toggles focus vs minimize, and never
  // spawns a second IDE window.
  const toggleAblixFromTaskbar = useCallback(() => {
    setAblix((prev) => {
      if (prev.status === "closed") {
        return { ...prev, status: "open", focused: true };
      }
      if (prev.status === "open" && prev.focused) {
        return { ...prev, status: "minimized", focused: false };
      }
      return { ...prev, status: "open", focused: true };
    });
  }, []);

  return {
    ablix,
    openAblix,
    focusAblix,
    minimizeAblix,
    closeAblix,
    toggleAblixFromTaskbar,
  };
}
