import { UiIcon } from "../icons/Icons";

export type SidebarView = "explorer" | "extensions";

export function ActivityBar({
  view,
  onChange,
}: {
  view: SidebarView;
  onChange: (view: SidebarView) => void;
}) {
  return (
    <div className="activity-bar">
      <button
        className={view === "explorer" ? "active" : ""}
        onClick={() => onChange("explorer")}
        title="Explorer"
        aria-label="Explorer"
      >
        <UiIcon name="folder" size={18} />
      </button>
      <button
        className={view === "extensions" ? "active" : ""}
        onClick={() => onChange("extensions")}
        title="Extensions"
        aria-label="Extensions"
      >
        <UiIcon name="plug" size={18} />
      </button>
    </div>
  );
}
