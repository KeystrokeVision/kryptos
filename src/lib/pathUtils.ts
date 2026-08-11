export interface Breadcrumb {
  label: string;
  path: string;
}

/**
 * Splits a path into clickable breadcrumb segments. Handles both Windows
 * drive-letter paths ("C:\Users\foo") and Unix paths ("/home/user"),
 * detected from whichever separator the path actually uses — the backend
 * always sends real OS paths, never a normalized form.
 */
export function buildBreadcrumbs(path: string): Breadcrumb[] {
  if (!path) return [];
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const crumbs: Breadcrumb[] = [];

  if (sep === "\\" && parts.length > 0 && /^[A-Za-z]:$/.test(parts[0])) {
    let acc = `${parts[0]}\\`;
    crumbs.push({ label: acc, path: acc });
    for (let i = 1; i < parts.length; i++) {
      acc = `${acc}${parts[i]}\\`;
      crumbs.push({ label: parts[i], path: acc });
    }
    return crumbs;
  }

  crumbs.push({ label: "/", path: "/" });
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

/** Joins a directory path with a leaf name using the same separator style as the directory path. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** The parent directory of a path, or null if it's already a root. */
export function parentPath(path: string): string | null {
  const crumbs = buildBreadcrumbs(path);
  if (crumbs.length <= 1) return null;
  return crumbs[crumbs.length - 2].path;
}

function normalizeForComparison(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

/** True if `path` is the same directory as `ancestor` or nested inside it — used by drag-and-drop to refuse dropping a folder into itself or one of its own children. */
export function isPathInside(path: string, ancestor: string): boolean {
  const a = normalizeForComparison(ancestor);
  const p = normalizeForComparison(path);
  return p === a || p.startsWith(`${a}/`);
}

/** True if `path` and `dir` refer to the same directory, ignoring trailing-separator/case differences. */
export function samePath(path: string, dir: string): boolean {
  return normalizeForComparison(path) === normalizeForComparison(dir);
}
