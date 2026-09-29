import { useState } from "react";
import type { PanelContribution, PanelNode } from "../types";
import { extensionHost } from "../useExtensionSystem";

const run = (command: string, ...args: unknown[]) =>
  extensionHost.executeCommand(command, ...args).catch((e) => extensionHost.notify(String(e.message ?? e), "error"));

function Node({ node }: { node: PanelNode }) {
  const [text, setText] = useState(node.type === "input" ? node.value ?? "" : "");
  switch (node.type) {
    case "heading": return <div className="pv-heading">{node.text}</div>;
    case "text": return <div className="pv-text">{node.text}</div>;
    case "code": return <pre className="pv-code">{node.text}</pre>;
    case "divider": return <hr className="pv-divider" />;
    case "button":
      return <button className="btn btn-secondary pv-button" onClick={() => run(node.command, ...(node.args !== undefined ? [node.args] : []))}>{node.label}</button>;
    case "input":
      return (
        <div className="pv-input">
          <input className="dialog-input" placeholder={node.placeholder} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(node.command, text); }} />
          <button className="btn btn-primary" onClick={() => run(node.command, text)}>{node.submitLabel ?? "Go"}</button>
        </div>
      );
    case "list":
      return (
        <div className="pv-list">
          {node.items.map((it, i) => (
            <div key={i} className={`pv-list-item${it.command ? " clickable" : ""}`}
              onClick={() => it.command && run(it.command, ...(it.args !== undefined ? [it.args] : []))}>
              <span>{it.label}</span>
              {it.detail && <span className="pv-list-detail">{it.detail}</span>}
            </div>
          ))}
        </div>
      );
    case "row": case "column":
      return <div className={`pv-${node.type}`}>{node.children.map((c, i) => <Node key={i} node={c} />)}</div>;
  }
}

/** Renders an extension panel from its declarative node tree (no raw HTML from extensions). */
export function PanelView({ panel }: { panel: PanelContribution }) {
  return (
    <div className="panel-view">
      <div className="ablix-explorer-header">{panel.title}</div>
      <div className="panel-view-body">
        {panel.content ? <Node node={panel.content} /> : <div className="pv-text">This panel has no content yet.</div>}
      </div>
    </div>
  );
}
