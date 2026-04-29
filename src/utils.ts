export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

export function dirname(path: string): string {
  const sep = path.includes("/") ? "/" : "\\";
  if (!path.includes(sep)) return "";
  const parts = path.split(sep);
  parts.pop();
  return parts.join(sep) || sep;
}
