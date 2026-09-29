import { UiIcon } from "../icons/Icons";
import type { PanelContribution } from "../extensions/types";

/** "explorer" | "extensions" | "panel:<extId>::<panelId>" (an extension-contributed panel). */
export type SidebarView = string;
export const panelViewId = (p: PanelContribution) => `panel:${p.extId}::${p.id}`;

export function ActivityBar({
  view,
  onChange,
  panels = [],
}: {
  view: SidebarView;
  onChange: (view: SidebarView) => void;
  panels?: PanelContribution[];
}) {
  return (
    <div className="activity-bar">
      <button className={view === "explorer" ? "active" : ""} onClick={() => onChange("explorer")} title="Explorer" aria-label="Explorer">
        <UiIcon name="folder" size={18} />
      </button>
      <button className={view === "extensions" ? "active" : ""} onClick={() => onChange("extensions")} title="Extensions" aria-label="Extensions">
        <UiIcon name="plug" size={18} />
      </button>
      {panels.map((p) => (
        <button
          key={panelViewId(p)}
          className={view === panelViewId(p) ? "active" : ""}
          onClick={() => onChange(panelViewId(p))}
          title={p.title}
          aria-label={p.title}
          data-panel-id={p.id}
        >
          <UiIcon name={p.icon ?? "puzzle-piece"} size={18} />
        </button>
      ))}
    </div>
  );
}
