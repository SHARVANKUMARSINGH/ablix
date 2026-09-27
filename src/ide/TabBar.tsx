import { FileIcon, UiIcon } from "../icons/Icons";

export interface EditorTab {
  path: string;
  dirty: boolean;
}

export function TabBar({
  tabs,
  activePath,
  onSelect,
  onClose,
}: {
  tabs: EditorTab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const name = tab.path.split("/").pop() ?? tab.path;
        return (
          <div
            key={tab.path}
            className={`tab${tab.path === activePath ? " active" : ""}`}
            onClick={() => onSelect(tab.path)}
            title={tab.path}
          >
            <FileIcon filename={name} size={13} />
            <span className="tab-label">{name}</span>
            {tab.dirty && <span className="tab-dirty-dot" aria-label="Unsaved changes" />}
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.path);
              }}
              aria-label={`Close ${name}`}
            >
              <UiIcon name="close" size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
