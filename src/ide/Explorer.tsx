import { useMemo, useState } from "react";
import { FileIcon, UiIcon } from "../icons/Icons";
import { ContextMenu, type ContextMenuState } from "../desktop/components/ContextMenu";
import { PromptDialog, ConfirmDialog } from "../desktop/components/Dialogs";
import { buildFileTree, type ProjectFile, type TreeNode } from "../project/ProjectManager";

function filterKeep(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .filter((n) => n.name !== ".keep")
    .map((n) => ({ ...n, children: filterKeep(n.children) }));
}

function TreeRow({
  node,
  depth,
  activePath,
  expanded,
  onToggle,
  onOpenFile,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
}) {
  const isOpen = expanded.has(node.path);
  return (
    <>
      <div
        className={`explorer-row${node.path === activePath ? " active" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => (node.isFolder ? onToggle(node.path) : onOpenFile(node.path))}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(node, e.clientX, e.clientY);
        }}
      >
        {node.isFolder && (
          <UiIcon name={isOpen ? "chevron-down" : "chevron-right"} size={9} className="explorer-caret" />
        )}
        <FileIcon filename={node.name} isFolder={node.isFolder} isOpen={isOpen} size={14} />
        <span className="explorer-row-label">{node.name}</span>
      </div>
      {node.isFolder &&
        isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            activePath={activePath}
            expanded={expanded}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
            onContextMenu={onContextMenu}
          />
        ))}
    </>
  );
}

export function Explorer({
  files,
  activePath,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
}: {
  files: ProjectFile[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
}) {
  const tree = useMemo(() => filterKeep(buildFileTree(files)), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [creating, setCreating] = useState<{ kind: "file" | "folder"; base: string } | null>(
    null
  );
  const [renaming, setRenaming] = useState<TreeNode | null>(null);
  const [deleting, setDeleting] = useState<TreeNode | null>(null);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const showMenuFor = (node: TreeNode | null, x: number, y: number) => {
    const base = node?.isFolder ? node.path : node ? node.path.split("/").slice(0, -1).join("/") : "";
    if (!node) {
      setMenu({
        x,
        y,
        items: [
          { label: "New File", icon: "new-file", onSelect: () => setCreating({ kind: "file", base }) },
          { label: "New Folder", icon: "new-folder", onSelect: () => setCreating({ kind: "folder", base }) },
        ],
      });
      return;
    }
    setMenu({
      x,
      y,
      items: [
        ...(node.isFolder
          ? [
              {
                label: "New File",
                icon: "new-file",
                onSelect: () => setCreating({ kind: "file", base: node.path }),
              },
              {
                label: "New Folder",
                icon: "new-folder",
                onSelect: () => setCreating({ kind: "folder", base: node.path }),
              },
            ]
          : []),
        { label: "Rename", icon: "rename", onSelect: () => setRenaming(node) },
        { label: "Delete", icon: "trash", danger: true, onSelect: () => setDeleting(node) },
      ],
    });
  };

  return (
    <div
      className="explorer"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          showMenuFor(null, e.clientX, e.clientY);
        }
      }}
    >
      <div className="ablix-explorer-header">Explorer</div>
      {tree.length === 0 && <div className="ablix-explorer-empty">No files yet — right-click to create one</div>}
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          expanded={expanded}
          onToggle={toggle}
          onOpenFile={onOpenFile}
          onContextMenu={(n, x, y) => showMenuFor(n, x, y)}
        />
      ))}

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />

      {creating && (
        <PromptDialog
          title={creating.kind === "file" ? "New File" : "New Folder"}
          label="Name:"
          defaultValue={creating.kind === "file" ? "untitled.txt" : "New Folder"}
          onCancel={() => setCreating(null)}
          onConfirm={(name) => {
            const path = creating.base ? `${creating.base}/${name}` : name;
            creating.kind === "file" ? onCreateFile(path) : onCreateFolder(path);
            setCreating(null);
          }}
        />
      )}

      {renaming && (
        <PromptDialog
          title="Rename"
          label="Name:"
          defaultValue={renaming.name}
          confirmLabel="Rename"
          onCancel={() => setRenaming(null)}
          onConfirm={(name) => {
            const parent = renaming.path.split("/").slice(0, -1).join("/");
            const newPath = parent ? `${parent}/${name}` : name;
            onRename(renaming.path, newPath);
            setRenaming(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={deleting.isFolder ? "Delete Folder?" : "Delete File?"}
          message={`Are you sure you want to delete "${deleting.name}"?`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDelete(deleting.path, deleting.isFolder);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}
