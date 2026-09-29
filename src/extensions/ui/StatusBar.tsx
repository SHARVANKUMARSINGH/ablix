import type { Diagnostic, StatusItem } from "../types";
import { extensionHost } from "../useExtensionSystem";
import { UiIcon } from "../../icons/Icons";

export function StatusBar({
  languageName, diagnostics, items, onShowProblems,
}: {
  languageName: string | null;
  diagnostics: Diagnostic[];
  items: StatusItem[];
  onShowProblems: () => void;
}) {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  const render = (it: StatusItem) => (
    <button
      key={`${it.extId}::${it.id}`}
      className={`statusbar-item${it.command ? " clickable" : ""}`}
      title={it.tooltip}
      disabled={!it.command}
      data-status-id={it.id}
      onClick={() => it.command && extensionHost.executeCommand(it.command).catch((e) => extensionHost.notify(String(e.message ?? e), "error"))}
    >
      {it.text}
    </button>
  );
  return (
    <div className="ide-statusbar">
      <div className="statusbar-group">
        <button className="statusbar-item clickable" onClick={onShowProblems} title="Show problems" data-testid="problems">
          <UiIcon name="warning" size={10} /> {errors} {warnings > 0 && <>· {warnings}</>}
        </button>
        {sorted.filter((i) => i.alignment === "left").map(render)}
      </div>
      <div className="statusbar-group">
        {sorted.filter((i) => i.alignment === "right").map(render)}
        {languageName && <span className="statusbar-item">{languageName}</span>}
      </div>
    </div>
  );
}
