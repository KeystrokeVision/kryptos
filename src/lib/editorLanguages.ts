const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  sh: "shell",
  bash: "shell",
  ps1: "powershell",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  xml: "xml",
  dockerfile: "dockerfile",
  bat: "bat",
  lua: "lua",
  swift: "swift",
  txt: "plaintext",
};

export function languageForPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  if (name.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return EXTENSION_LANGUAGE_MAP[ext] ?? "plaintext";
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

const RUNNABLE_EXTENSIONS = new Set(["ps1", "sh", "bash", "py", "bat", "cmd", "js", "mjs"]);

export function isRunnableScript(path: string): boolean {
  const name = fileNameFromPath(path);
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return RUNNABLE_EXTENSIONS.has(ext);
}
