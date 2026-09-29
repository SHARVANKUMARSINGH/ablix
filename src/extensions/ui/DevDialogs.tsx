import { useState } from "react";
import { slugify, type NewExtensionOptions } from "../devtools";
import { PACKAGE_EXT } from "../package";

export function CreateExtensionDialog({
  existingFolders, onCancel, onCreate,
}: {
  existingFolders: string[];
  onCancel: () => void;
  onCreate: (o: NewExtensionOptions) => void;
}) {
  const [name, setName] = useState("My Extension");
  const [author, setAuthor] = useState("me");
  const [description, setDescription] = useState("My first Ablix extension");
  const slug = slugify(name);
  const folder = slug;
  const id = `${slugify(author)}.${slug}`;
  const clash = existingFolders.includes(folder);
  const valid = name.trim() && author.trim() && description.trim() && !clash;

  return (
    <div className="dialog-overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog dialog-left">
        <h2>Create Extension</h2>
        <label className="dialog-label">Name</label>
        <input autoFocus className="dialog-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Extension name" />
        <label className="dialog-label ext-gap">Author</label>
        <input className="dialog-input" value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Author" />
        <label className="dialog-label ext-gap">Description</label>
        <input className="dialog-input" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
        <p className="dialog-message ext-gap">
          Creates <code>{folder}/</code> with manifest.json, extension.js and README.md (id <code>{id}</code>).
          {clash && <span className="ext-inline-error"> A folder named “{folder}” already exists.</span>}
        </p>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onCreate({ folder, id, name: name.trim(), author: author.trim(), description: description.trim() })}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export function PackageResultDialog({
  filename, size, name, version, onDownload, onInstall, onClose,
}: {
  filename: string; size: number; name: string; version: string;
  onDownload: () => void; onInstall: () => void; onClose: () => void;
}) {
  return (
    <div className="dialog-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-left">
        <h2>Package ready</h2>
        <p className="dialog-message">
          <b>{filename}</b> ({(size / 1024).toFixed(1)} KB) — {name} {version}. A {PACKAGE_EXT} file is a ZIP containing manifest.json, extension.js and README.md.
        </p>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-secondary" onClick={onDownload}>Download</button>
          <button className="btn btn-primary" onClick={onInstall}>Install now</button>
        </div>
      </div>
    </div>
  );
}
