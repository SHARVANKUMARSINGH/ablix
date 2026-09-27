import { useCallback, useEffect, useState } from "react";

/**
 * Wraps the standard Fullscreen API on document.documentElement. Puts the
 * whole desktop shell (wallpaper, taskbar, windows — everything) into the
 * browser's real fullscreen mode, hiding tab/address-bar chrome, rather than
 * just resizing something inside the page.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== "undefined" && document.fullscreenElement != null
  );
  const [supported] = useState(
    () => typeof document !== "undefined" && document.fullscreenEnabled
  );

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    if (!supported) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {
        // Some browsers refuse without a direct user gesture or in certain
        // embedding contexts (e.g. some iframes) — fail silently, the button
        // just stays in its current state.
      });
    }
  }, [supported]);

  return { isFullscreen, supported, toggle };
}
