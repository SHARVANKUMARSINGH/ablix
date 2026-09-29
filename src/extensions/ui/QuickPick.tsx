import { useEffect, useMemo, useRef, useState } from "react";
import type { QuickPickItem } from "../types";

/** Filterable list (Command Palette, showQuickPick, install confirmation, problems). Keyboard + touch. */
export function QuickPick({
  title, placeholder, items, onPick, onCancel,
}: {
  title?: string;
  placeholder?: string;
  items: QuickPickItem[];
  onPick: (item: QuickPickItem) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => `${i.label} ${i.detail ?? ""}`.toLowerCase().includes(q)) : items;
  }, [items, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    (listRef.current?.children[index] as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  return (
    <div className="quickpick-overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="quickpick" role="dialog" aria-label={title ?? "Quick pick"}>
        {title && <div className="quickpick-title">{title}</div>}
        <input
          autoFocus
          className="quickpick-input"
          placeholder={placeholder ?? "Type to filter…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            else if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(shown.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter" && shown[index]) onPick(shown[index]);
          }}
        />
        <div className="quickpick-list" ref={listRef}>
          {shown.length === 0 && <div className="quickpick-empty">No matches</div>}
          {shown.map((it, i) => (
            <div
              key={i}
              className={`quickpick-item${i === index ? " active" : ""}`}
              onPointerEnter={() => setIndex(i)}
              onClick={() => onPick(it)}
            >
              <span className="quickpick-label">{it.label}</span>
              {it.detail && <span className="quickpick-detail">{it.detail}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function InputBox({
  title, prompt, placeholder, value, onSubmit, onCancel,
}: {
  title?: string; prompt?: string; placeholder?: string; value?: string;
  onSubmit: (v: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(value ?? "");
  return (
    <div className="quickpick-overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="quickpick" role="dialog" aria-label={title ?? "Input"}>
        {title && <div className="quickpick-title">{title}</div>}
        {prompt && <div className="quickpick-prompt">{prompt}</div>}
        <input
          autoFocus
          className="quickpick-input"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter") onSubmit(text);
          }}
        />
      </div>
    </div>
  );
}
