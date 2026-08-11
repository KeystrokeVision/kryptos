import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// Only the base editor worker — no per-language IntelliSense workers
// (json/css/html/ts). KRYPTOS's editor is for config files and scripts on
// a system you're administering, not a full IDE; dropping the TypeScript
// language service worker in particular avoids a very heavy bundle for a
// feature (deep IntelliSense) that isn't the point of this editor. Basic
// syntax highlighting for every language still works via Monaco's built-in
// Monarch tokenizers, which don't need a dedicated worker at all.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

// Point @monaco-editor/react at the bundled instance instead of its default
// behavior of fetching Monaco from a CDN at runtime — required for this
// desktop app to work fully offline.
loader.config({ monaco });

export const KRYPTOS_MONACO_THEME = "kryptos-dark";

// A custom theme matching KRYPTOS's own color tokens (tailwind.config.ts)
// instead of Monaco's generic "vs-dark" — the last place in the app that
// didn't share the same visual identity as everything else.
monaco.editor.defineTheme(KRYPTOS_MONACO_THEME, {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "5C5C5C", fontStyle: "italic" },
    { token: "keyword", foreground: "FF3B3B" },
    { token: "keyword.control", foreground: "FF3B3B" },
    { token: "string", foreground: "00D26A" },
    { token: "number", foreground: "FFB020" },
    { token: "type", foreground: "FF6B6B" },
    { token: "type.identifier", foreground: "FF6B6B" },
    { token: "function", foreground: "EAEAEA" },
    { token: "variable", foreground: "EAEAEA" },
    { token: "variable.predefined", foreground: "FFB020" },
    { token: "delimiter", foreground: "8A8A8A" },
    { token: "tag", foreground: "FF3B3B" },
    { token: "attribute.name", foreground: "FFB020" },
    { token: "attribute.value", foreground: "00D26A" },
  ],
  colors: {
    "editor.background": "#0A0A0A",
    "editor.foreground": "#EAEAEA",
    "editorLineNumber.foreground": "#5C5C5C",
    "editorLineNumber.activeForeground": "#FF3B3B",
    "editor.selectionBackground": "#B0002055",
    "editor.inactiveSelectionBackground": "#22222280",
    "editor.lineHighlightBackground": "#0D0D0D",
    "editorCursor.foreground": "#FF3B3B",
    "editorIndentGuide.background": "#1A1A1A",
    "editorIndentGuide.activeBackground": "#222222",
    "editorWhitespace.foreground": "#1A1A1A",
    "editorGutter.background": "#0A0A0A",
    "scrollbarSlider.background": "#22222280",
    "scrollbarSlider.hoverBackground": "#333333a0",
  },
});
