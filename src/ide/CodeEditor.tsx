import { useEffect, useMemo, useRef } from "react";
import { highlightLine, langFromFilename } from "./syntaxHighlight";

export function CodeEditor({
  filename,
  value,
  onChange,
  onSave,
  wordWrap = false,
}: {
  filename: string;
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  wordWrap?: boolean;
}) {
  const lang = useMemo(() => langFromFilename(filename), [filename]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => value.split("\n"), [value]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart, selectionEnd } = ta;
      const next = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = selectionStart + 2;
      });
    }
  };

  return (
    <div className={`code-editor${wordWrap ? " wrap" : ""}`}>
      <div className="code-editor-gutter" ref={gutterRef}>
        {lines.map((_, i) => (
          <div key={i} className="code-editor-line-number">
            {i + 1}
          </div>
        ))}
      </div>
      <div className="code-editor-body">
        <pre className="code-editor-highlight" ref={preRef} aria-hidden="true">
          {lines.map((line, i) => (
            <div key={i} className="code-editor-line">
              {highlightLine(line, lang).map((tok, j) => (
                <span key={j} className={tok.cls}>
                  {tok.text}
                </span>
              ))}
              {"\n"}
            </div>
          ))}
        </pre>
        <textarea
          ref={textareaRef}
          className="code-editor-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap={wordWrap ? "soft" : "off"}
        />
      </div>
    </div>
  );
}
