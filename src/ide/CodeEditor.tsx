import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { highlightLine, langFromFilename, type Token } from "./syntaxHighlight";
import type { CompletionItem, Diagnostic, LanguageContribution } from "../extensions/types";
import { expandSnippet } from "../extensions/snippets";

export interface EditorHandle {
  getSelection(): { start: number; end: number };
  replaceSelection(text: string): void;
  insertText(text: string): void;
  goTo(line: number, column?: number): void;
  focus(): void;
}

interface Popup { items: CompletionItem[]; index: number; left: number; top: number; from: number; to: number }

const LINE_HEIGHT = 20;

/** Pixel position (relative to the textarea's visible box) of a caret offset, wrap-aware. */
function caretCoords(ta: HTMLTextAreaElement, pos: number) {
  const cs = getComputedStyle(ta);
  const div = document.createElement("div");
  const st = div.style as unknown as Record<string, string>;
  for (const p of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "whiteSpace", "wordBreak", "tabSize",
    "paddingTop", "paddingLeft", "paddingRight", "paddingBottom", "boxSizing"] as const) st[p] = cs[p];
  div.style.cssText += ";position:absolute;visibility:hidden;top:0;left:-9999px;overflow:hidden;";
  div.style.width = `${ta.clientWidth}px`;
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement("span");
  span.textContent = "\u200b";
  div.appendChild(span);
  document.body.appendChild(div);
  const out = { top: span.offsetTop - ta.scrollTop, left: span.offsetLeft - ta.scrollLeft };
  div.remove();
  return out;
}

interface Range { s: number; e: number; cls: string }
function decorate(tokens: Token[], line: string, diags: Diagnostic[]): Token[] {
  const ranges: Range[] = diags.map((d) => {
    const first = line.search(/\S/);
    const s = d.column ? d.column - 1 : Math.max(0, first);
    const word = /^[\w$]+/.exec(line.slice(s))?.[0].length ?? 1;
    const e = d.endColumn ? d.endColumn - 1 : d.column ? s + word : line.length;
    return { s, e: Math.max(e, s + 1), cls: `diag-${d.severity}` };
  });
  const out: Token[] = [];
  let pos = 0;
  for (const t of tokens) {
    const start = pos;
    const end = pos + t.text.length;
    const cuts = new Set([start, end]);
    for (const r of ranges) {
      if (r.s > start && r.s < end) cuts.add(r.s);
      if (r.e > start && r.e < end) cuts.add(r.e);
    }
    const pts = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const r = ranges.find((x) => x.s < pts[i + 1] && x.e > pts[i]);
      out.push({ text: t.text.slice(pts[i] - start, pts[i + 1] - start), cls: `${t.cls}${r ? ` ${r.cls}` : ""}`.trim() });
    }
    pos = end;
  }
  return out;
}

export const CodeEditor = forwardRef<EditorHandle, {
  filename: string;
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  wordWrap?: boolean;
  customLanguages?: LanguageContribution[];
  diagnostics?: Diagnostic[];
  requestCompletions?: (offset: number) => Promise<CompletionItem[]>;
  onContextMenu?: (x: number, y: number) => boolean;
}>(function CodeEditor(
  { filename, value, onChange, onSave, wordWrap = false, customLanguages = [], diagnostics = [], requestCompletions, onContextMenu },
  ref
) {
  const lang = useMemo(() => langFromFilename(filename, customLanguages), [filename, customLanguages]);
  const rules = useMemo(() => customLanguages.find((l) => l.id === lang)?.rules, [customLanguages, lang]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const reqId = useRef(0);
  const [popup, setPopup] = useState<Popup | null>(null);

  const lines = useMemo(() => value.split("\n"), [value]);
  const diagByLine = useMemo(() => {
    const m = new Map<number, Diagnostic[]>();
    for (const d of diagnostics) m.set(d.line, [...(m.get(d.line) ?? []), d]);
    return m;
  }, [diagnostics]);

  const syncScroll = () => {
    if (!textareaRef.current) return;
    const { scrollTop, scrollLeft } = textareaRef.current;
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop;
      preRef.current.scrollLeft = scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop;
  };
  useEffect(syncScroll, [value]);

  useEffect(() => {
    const sel = pendingSel.current;
    const ta = textareaRef.current;
    if (sel && ta && ta.value === value) {
      ta.setSelectionRange(sel[0], sel[1]);
      pendingSel.current = null;
    }
  }, [value]);

  useEffect(() => setPopup(null), [filename]);

  const apply = (next: string, selStart: number, selEnd = selStart) => {
    pendingSel.current = [selStart, selEnd];
    onChange(next);
  };

  useImperativeHandle(ref, () => ({
    getSelection: () => {
      const ta = textareaRef.current;
      return { start: ta?.selectionStart ?? 0, end: ta?.selectionEnd ?? 0 };
    },
    replaceSelection: (text) => {
      const ta = textareaRef.current;
      const v = valueRef.current;
      const s = ta?.selectionStart ?? v.length;
      const e = ta?.selectionEnd ?? v.length;
      apply(v.slice(0, s) + text + v.slice(e), s + text.length);
    },
    insertText: (text) => {
      const ta = textareaRef.current;
      const v = valueRef.current;
      const s = ta?.selectionStart ?? v.length;
      apply(v.slice(0, s) + text + v.slice(s), s + text.length);
    },
    goTo: (line, column = 1) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const ls = valueRef.current.split("\n");
      const ln = Math.min(Math.max(1, line), ls.length);
      let off = 0;
      for (let i = 0; i < ln - 1; i++) off += ls[i].length + 1;
      off += Math.min(Math.max(0, column - 1), ls[ln - 1].length);
      ta.focus();
      ta.setSelectionRange(off, off);
      ta.scrollTop = Math.max(0, (ln - 3) * LINE_HEIGHT);
      syncScroll();
    },
    focus: () => textareaRef.current?.focus(),
  }));

  /* ---- autocomplete ---- */
  const trigger = async (force: boolean) => {
    const ta = textareaRef.current;
    if (!ta || !requestCompletions) return;
    const pos = ta.selectionStart;
    const prefix = /[\w$]*$/.exec(ta.value.slice(0, pos))?.[0] ?? "";
    if (!force && prefix.length < 1) return setPopup(null);
    const id = ++reqId.current;
    const items = await requestCompletions(pos).catch(() => [] as CompletionItem[]);
    if (id !== reqId.current) return;
    const p = prefix.toLowerCase();
    const seen = new Set<string>();
    const matches = items
      .filter((it) => (p ? it.label.toLowerCase().includes(p) : true) && it.label !== prefix)
      .sort((a, b) => Number(b.label.toLowerCase().startsWith(p)) - Number(a.label.toLowerCase().startsWith(p)))
      .filter((it) => (seen.has(it.label + it.detail) ? false : (seen.add(it.label + it.detail), true)))
      .slice(0, 8);
    if (!matches.length) return setPopup(null);
    const from = pos - prefix.length;
    const c = caretCoords(ta, from);
    const bw = bodyRef.current?.clientWidth ?? 300;
    const bh = bodyRef.current?.clientHeight ?? 300;
    const h = matches.length * 26 + 6;
    const below = c.top + 8 + LINE_HEIGHT;
    setPopup({
      items: matches, index: 0, from, to: pos,
      left: Math.max(0, Math.min(c.left, bw - 230)),
      top: below + h > bh && c.top - h > 0 ? c.top - h + 8 : below,
    });
  };

  const accept = (item: CompletionItem, p: Popup) => {
    const text = item.insertText ?? item.label;
    const v = valueRef.current;
    const { text: out, start, end } = item.isSnippet ? expandSnippet(text) : { text, start: text.length, end: text.length };
    apply(v.slice(0, p.from) + out + v.slice(p.to), p.from + start, p.from + end);
    setPopup(null);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popup) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = popup.items.length;
        setPopup({ ...popup, index: (popup.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        accept(popup.items[popup.index], popup);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPopup(null);
        return;
      }
    }
    if (e.ctrlKey && e.key === " ") {
      e.preventDefault();
      void trigger(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart, selectionEnd } = ta;
      apply(value.slice(0, selectionStart) + "  " + value.slice(selectionEnd), selectionStart + 2);
    }
  };

  return (
    <div className={`code-editor${wordWrap ? " wrap" : ""}`}>
      <div className="code-editor-gutter" ref={gutterRef}>
        {lines.map((_, i) => {
          const d = diagByLine.get(i + 1);
          const worst = d?.some((x) => x.severity === "error") ? "error" : d?.some((x) => x.severity === "warning") ? "warning" : d ? "info" : "";
          return (
            <div key={i} className={`code-editor-line-number${worst ? ` gutter-${worst}` : ""}`}>
              {i + 1}
            </div>
          );
        })}
      </div>
      <div className="code-editor-body" ref={bodyRef}>
        <pre className="code-editor-highlight" ref={preRef} aria-hidden="true">
          {lines.map((line, i) => {
            const base = highlightLine(line, lang, rules);
            const d = diagByLine.get(i + 1);
            return (
              <div key={i} className="code-editor-line">
                {(d ? decorate(base, line, d) : base).map((tok, j) => (
                  <span key={j} className={tok.cls}>
                    {tok.text}
                  </span>
                ))}
                {"\n"}
              </div>
            );
          })}
        </pre>
        <textarea
          ref={textareaRef}
          className="code-editor-input"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            const type = (e.nativeEvent as InputEvent).inputType ?? "";
            if (type.startsWith("insert")) requestAnimationFrame(() => void trigger(false));
            else setPopup(null);
          }}
          onScroll={() => {
            syncScroll();
            if (popup) setPopup(null);
          }}
          onBlur={() => setPopup(null)}
          onKeyDown={handleKeyDown}
          onContextMenu={(e) => {
            if (onContextMenu?.(e.clientX, e.clientY)) e.preventDefault();
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap={wordWrap ? "soft" : "off"}
          data-testid="code-editor-input"
        />
        {popup && (
          <div className="completion-popup" style={{ left: popup.left, top: popup.top }} role="listbox">
            {popup.items.map((it, i) => (
              <div
                key={it.label + i}
                role="option"
                aria-selected={i === popup.index}
                className={`completion-item${i === popup.index ? " active" : ""}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  accept(it, popup);
                }}
              >
                <span className="completion-kind">{(it.kind ?? "abc").slice(0, 3)}</span>
                <span className="completion-label">{it.label}</span>
                {it.detail && <span className="completion-detail">{it.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
