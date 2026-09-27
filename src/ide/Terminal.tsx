import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  getWebContainer,
  isWebContainerSupported,
  toFileSystemTree,
  watchContainerFiles,
} from "./webcontainer";
import { UiIcon } from "../icons/Icons";
import { ProjectManager, type ProjectFile, type ProjectRecord } from "../project/ProjectManager";

type Status = "idle" | "booting" | "ready" | "unsupported" | "error";

export interface TerminalHandle {
  /** Types a command into the running shell as if the user had typed it. */
  runCommand: (command: string) => void;
}

export const TerminalPanel = forwardRef<
  TerminalHandle,
  {
    projectId: string;
    files: ProjectFile[];
    visible: boolean;
    onClose: () => void;
    onProjectChanged: (next: ProjectRecord) => void;
  }
>(function TerminalPanel({ projectId, files, visible, onClose, onProjectChanged }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const inputWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [retryTick, setRetryTick] = useState(0);

  useImperativeHandle(ref, () => ({
    runCommand: (command: string) => {
      inputWriterRef.current?.write(`${command}\n`);
    },
  }));

  // Boot (or reboot on retry). This effect only re-runs on retry, not on
  // every files/visible change, so the shell session survives panel toggles.
  useEffect(() => {
    if (!hostRef.current) return;
    const term = new XTerm({
      convertEol: true,
      fontSize: 13,
      fontFamily: "Menlo, Consolas, monospace",
      theme: { background: "#14161b" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    fitRef.current = fit;

    if (!isWebContainerSupported()) {
      setStatus("unsupported");
      term.writeln("Ablix Terminal");
      term.writeln("");
      term.writeln("WebContainer is unavailable: this page is not cross-origin isolated.");
      term.writeln("Serve with the COOP/COEP headers in public/_headers (Cloudflare Pages");
      term.writeln("applies these automatically; `npm run dev`/`preview` set them too) and reload.");
      return () => term.dispose();
    }

    let disposed = false;
    let stopWatch: (() => void) | undefined;
    setStatus("booting");
    setErrorMsg("");
    term.writeln(retryTick > 0 ? "Retrying WebContainer boot\u2026" : "Booting WebContainer\u2026");

    (async () => {
      try {
        const wc = await getWebContainer();
        if (disposed) return;
        await wc.mount(toFileSystemTree(filesRef.current));
        const shell = await wc.spawn("jsh", { terminal: { cols: term.cols, rows: term.rows } });
        if (disposed) return;
        shell.output.pipeTo(
          new WritableStream({
            write(data) {
              term.write(data);
            },
          })
        );
        const inputWriter = shell.input.getWriter();
        inputWriterRef.current = inputWriter;
        term.onData((data) => inputWriter.write(data));
        setStatus("ready");

        // Mirror container-side file writes (from the shell, npm, a dev
        // server) back into the project record so Explorer/editor stay live.
        stopWatch = watchContainerFiles(wc, (path, content) => {
          ProjectManager.writeFile(projectId, path, content).then((updated) => {
            if (updated) onProjectChanged(updated);
          });
        });
      } catch (err) {
        if (disposed) return;
        setStatus("error");
        const message = err instanceof Error ? err.message : String(err);
        setErrorMsg(message);
        term.writeln(`\nFailed to start WebContainer: ${message}`);
      }
    })();

    return () => {
      disposed = true;
      inputWriterRef.current = null;
      stopWatch?.();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

  // Re-fit whenever the panel becomes visible or the window/container resizes
  // — this is what keeps the panel usable across toggling and drag-resizing
  // instead of frozen at its first-render size.
  useEffect(() => {
    if (!visible) return;
    const doFit = () => fitRef.current?.fit();
    doFit();
    window.addEventListener("resize", doFit);
    const id = window.setInterval(doFit, 400); // catches manual panel resize drags
    return () => {
      window.removeEventListener("resize", doFit);
      window.clearInterval(id);
    };
  }, [visible]);

  return (
    <div className="terminal-panel" style={{ display: visible ? "flex" : "none" }}>
      <div className="terminal-panel-header">
        <span>Terminal</span>
        <div className="terminal-panel-header-right">
          <span className={`terminal-status terminal-status-${status}`}>
            {status === "booting" && "starting\u2026"}
            {status === "ready" && "running"}
            {status === "unsupported" && "unavailable"}
            {status === "error" && "error"}
          </span>
          {status === "ready" && (
            <button
              className="terminal-retry"
              onClick={() => inputWriterRef.current?.write("npm install && npm run dev\n")}
              title="Runs `npm install && npm run dev` in this shell"
            >
              <UiIcon name="play" size={11} /> Run
            </button>
          )}
          {status === "error" && (
            <button className="terminal-retry" onClick={() => setRetryTick((t) => t + 1)}>
              <UiIcon name="refresh" size={11} /> Retry
            </button>
          )}
          <button className="terminal-close" onClick={onClose} aria-label="Close terminal">
            <UiIcon name="close" size={12} />
          </button>
        </div>
      </div>
      <div className="terminal-host" ref={hostRef} />
      {status === "error" && <div className="terminal-error-note">{errorMsg}</div>}
    </div>
  );
});

// Default export exists so this heavy module (xterm + @webcontainer/api) can
// be code-split with React.lazy — it's only pulled in once the terminal is
// actually opened, not in the main app bundle.
export default TerminalPanel;
