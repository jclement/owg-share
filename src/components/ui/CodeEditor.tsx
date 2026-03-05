import { useRef, useEffect } from "react";
import { EditorView, placeholder as placeholderExt } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";
import { StreamLanguage } from "@codemirror/language";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";

function getLanguageExtension(lang: string) {
  const map: Record<string, () => ReturnType<typeof markdown>> = {
    markdown, javascript, typescript: () => javascript({ typescript: true }),
    jsx: () => javascript({ jsx: true }), tsx: () => javascript({ jsx: true, typescript: true }),
    python, html, css, json, sql, xml, rust, go, java, c: cpp, cpp, csharp: cpp, php,
    elixir: () => StreamLanguage.define(ruby),
  };
  return map[lang]?.() ?? null;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  placeholder?: string;
  minHeight?: string;
}

export function CodeEditor({ value, onChange, language = "", placeholder = "", minHeight = "300px" }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      basicSetup,
      oneDark,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        "&": { minHeight, fontSize: "14px" },
        ".cm-scroller": { overflow: "auto" },
        ".cm-content": { fontFamily: "var(--font-mono)" },
      }),
    ];

    if (placeholder) {
      extensions.push(placeholderExt(placeholder));
    }

    const langExt = getLanguageExtension(language);
    if (langExt) extensions.push(langExt);

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create once on mount - language changes recreate via key prop from parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes (but not from typing)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (value !== currentValue) {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-neutral-300 dark:border-neutral-700 overflow-hidden [&_.cm-editor]:!outline-none"
    />
  );
}
