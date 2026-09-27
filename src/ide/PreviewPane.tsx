import { useEffect, useState } from "react";
import { getWebContainer, isWebContainerSupported } from "./webcontainer";
import { UiIcon } from "../icons/Icons";

function PreviewPaneImpl({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!isWebContainerSupported()) {
      setSupported(false);
      return;
    }
    let cancelled = false;
    getWebContainer()
      .then((wc) => {
        wc.on("server-ready", (_port, serverUrl) => {
          if (!cancelled) setUrl(serverUrl);
        });
      })
      .catch(() => {
        if (!cancelled) setSupported(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="preview-pane" style={{ display: visible ? "flex" : "none" }}>
      <div className="preview-pane-header">
        <span>Preview</span>
        <button onClick={onClose} aria-label="Close preview">
          <UiIcon name="close" size={12} />
        </button>
      </div>
      <div className="preview-pane-body">
        {!supported ? (
          <div className="preview-pane-empty">
            <UiIcon name="eye" size={28} />
            <p>Preview needs a running dev server inside WebContainer.</p>
          </div>
        ) : !url ? (
          <div className="preview-pane-empty">
            <UiIcon name="play" size={28} />
            <p>Run a dev server in the terminal (e.g. npm run dev) to see a live preview here.</p>
          </div>
        ) : (
          <iframe
            className="preview-pane-frame"
            src={url}
            title="Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </div>
    </div>
  );
}

export default PreviewPaneImpl;
