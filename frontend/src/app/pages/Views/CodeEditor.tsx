import React, { useRef, useEffect, useMemo } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { useThemeMode } from '@/shared/styles/ThemeContext';

type Language = 'html' | 'python' | 'json';

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: Language;
  placeholder?: string;
}

const langExtension = (lang: Language) => {
  switch (lang) {
    case 'html': return html();
    case 'python': return python();
    case 'json': return json();
  }
};

// Windows-Electron: CodeMirror's EditorView mounts a contenteditable surface internally; same Chromium 144 TSF crash as EditorSurface. Skip CodeMirror entirely on Windows and render a plain <textarea> (no syntax highlighting, but no segfault).
const IS_WIN_ELECTRON = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows') && navigator.userAgent.includes('Electron');

const CodeEditor: React.FC<Props> = ({ value, onChange, language, placeholder }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const { mode } = useThemeMode();

  onChangeRef.current = onChange;

  const extensions = useMemo(() => {
    const exts = [
      basicSetup,
      langExtension(language),
      keymap.of([...defaultKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
        '.cm-gutters': { border: 'none' },
      }),
    ];
    if (mode === 'dark') exts.push(oneDark);
    if (placeholder) exts.push(cmPlaceholder(placeholder));
    return exts;
  }, [language, mode, placeholder]);

  useEffect(() => {
    if (IS_WIN_ELECTRON || !containerRef.current) return;

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions]);

  useEffect(() => {
    if (IS_WIN_ELECTRON) return;
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  if (IS_WIN_ELECTRON) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          width: '100%',
          height: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          padding: '8px',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          fontSize: '13px',
          color: mode === 'dark' ? '#fff' : '#000',
        }}
      />
    );
  }

  return <div ref={containerRef} style={{ height: '100%', width: '100%', overflow: 'hidden' }} />;
};

export default CodeEditor;
