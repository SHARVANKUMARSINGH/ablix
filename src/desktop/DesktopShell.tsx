import { useEffect, useState } from "react";
import { Wallpaper } from "./components/Wallpaper";
import { Desktop } from "./components/Desktop";
import { Taskbar } from "./components/Taskbar";
import { AblixIDE } from "./components/AblixIDE";
import { useWindowManager } from "./useWindowManager";
import { ProjectManager, type ProjectRecord } from "../project/ProjectManager";

export function DesktopShell() {
  const { ablix, openAblix, focusAblix, minimizeAblix, closeAblix, toggleAblixFromTaskbar } =
    useWindowManager();
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);

  useEffect(() => {
    if (!ablix.activeProjectId) {
      setActiveProject(null);
      return;
    }
    ProjectManager.get(ablix.activeProjectId).then((p) => setActiveProject(p ?? null));
  }, [ablix.activeProjectId]);

  const handleOpenInAblix = (projectId: string) => {
    openAblix(projectId || null);
  };

  return (
    <div className="desktop-shell">
      <Wallpaper />
      <Desktop onOpenInAblix={handleOpenInAblix} />
      <AblixIDE
        window={ablix}
        project={activeProject}
        onFocus={focusAblix}
        onMinimize={minimizeAblix}
        onClose={closeAblix}
        onProjectChanged={setActiveProject}
      />
      <Taskbar ablix={ablix} onToggleAblix={toggleAblixFromTaskbar} />
    </div>
  );
}
