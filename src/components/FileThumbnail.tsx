import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateFile } from "../types";
import { openFile } from "../fileActions";

// Marge approximant 2 hauteurs de card (~150px chacune)
const PRELOAD_MARGIN = "300px";

type FileCategory = "pdf" | "archive" | "code" | "document" | "spreadsheet" | "presentation" | "generic";

const EXT_TO_CATEGORY: Record<string, FileCategory> = {
  pdf: "pdf",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
  bz2: "archive", xz: "archive", tgz: "archive", cab: "archive", deb: "archive", rpm: "archive",
  js: "code", ts: "code", jsx: "code", tsx: "code", py: "code", rs: "code", go: "code",
  java: "code", c: "code", cpp: "code", h: "code", hpp: "code", cs: "code", php: "code",
  rb: "code", swift: "code", kt: "code", html: "code", css: "code", scss: "code",
  json: "code", xml: "code", yaml: "code", yml: "code", sh: "code", bat: "code", sql: "code",
  doc: "document", docx: "document", odt: "document", rtf: "document", txt: "document",
  md: "document", log: "document",
  xls: "spreadsheet", xlsx: "spreadsheet", ods: "spreadsheet", csv: "spreadsheet",
  ppt: "presentation", pptx: "presentation", odp: "presentation",
};

const CATEGORY_COLORS: Record<FileCategory, string> = {
  pdf: "#e74c3c",
  archive: "#f39c12",
  code: "#3498db",
  document: "#5dade2",
  spreadsheet: "#27ae60",
  presentation: "#e67e22",
  generic: "#95a5a6",
};

export function FileTypeIcon({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const category: FileCategory = EXT_TO_CATEGORY[ext] ?? "generic";
  const color = CATEGORY_COLORS[category];

  return (
    <svg
      className="file-thumb-icon"
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Page shape colore */}
      <path
        d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
        stroke={color} strokeWidth="1.5" fill={color} fillOpacity="0.12"
      />
      <polyline points="13 2 13 9 20 9" stroke={color} strokeWidth="1.5" fill="none" />

      {category === "pdf" && (<>
        <rect x="4" y="13" width="16" height="6" rx="0.8" fill={color} />
        <text x="12" y="17.7" textAnchor="middle" fontSize="4.3" fill="white"
          fontFamily="sans-serif" fontWeight="700">PDF</text>
      </>)}
      {category === "archive" && (<>
        {/* Fermeture eclair stylisee */}
        <rect x="11" y="10" width="2" height="11" fill={color} />
        <line x1="9" y1="12" x2="13" y2="12" stroke={color} strokeWidth="1" />
        <line x1="11" y1="14" x2="15" y2="14" stroke={color} strokeWidth="1" />
        <line x1="9" y1="16" x2="13" y2="16" stroke={color} strokeWidth="1" />
        <line x1="11" y1="18" x2="15" y2="18" stroke={color} strokeWidth="1" />
        <line x1="9" y1="20" x2="13" y2="20" stroke={color} strokeWidth="1" />
      </>)}
      {category === "code" && (
        <text x="12" y="19" textAnchor="middle" fontSize="8.5" fill={color}
          fontFamily="monospace" fontWeight="700">{"<>"}</text>
      )}
      {category === "document" && (<>
        <line x1="7" y1="13" x2="17" y2="13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="7" y1="16" x2="17" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="7" y1="19" x2="13" y2="19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </>)}
      {category === "spreadsheet" && (<>
        <rect x="6" y="12" width="12" height="8" stroke={color} strokeWidth="1.3" fill={color} fillOpacity="0.15" />
        <line x1="12" y1="12" x2="12" y2="20" stroke={color} strokeWidth="1.2" />
        <line x1="6" y1="16" x2="18" y2="16" stroke={color} strokeWidth="1.2" />
      </>)}
      {category === "presentation" && (<>
        {/* Diagramme en barres */}
        <line x1="8" y1="20" x2="8" y2="17" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="20" x2="12" y2="13" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <line x1="16" y1="20" x2="16" y2="15" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </>)}
      {category === "generic" && (<>
        <circle cx="12" cy="16" r="3" stroke={color} strokeWidth="1.3" fill="none" />
      </>)}
    </svg>
  );
}

export function FileThumbnail({ file, mode }: { file: DuplicateFile; mode: "image" | "video" | "audio" | "other" }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [near, setNear] = useState(false);
  const placeholderRef = useRef<HTMLSpanElement>(null);

  const isMedia = mode === "image" || mode === "video";

  useEffect(() => {
    if (!isMedia) return;
    const el = placeholderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setNear(true); },
      { rootMargin: `${PRELOAD_MARGIN} 0px` }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isMedia]);

  useEffect(() => {
    if (!near || !isMedia) return;
    const cmd = mode === "video" ? "get_video_thumbnail" : "get_image_thumbnail";
    const args = mode === "video"
      ? { path: file.path, maxSize: 64, duration: file.video_metadata?.duration_secs ?? null }
      : { path: file.path, maxSize: 64 };
    invoke<string>(cmd, args)
      .then(setThumb)
      .catch(() => setThumb("error"));
  }, [near, file.path, mode, isMedia]);

  if (mode === "audio") {
    return (
      <span
        className="file-thumb-audio"
        onClick={(e) => { e.stopPropagation(); openFile(file.path); }}
        title={file.name}
      >
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="18" cy="18" r="17" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
          <polygon points="14,11 28,18 14,25" fill="currentColor" opacity="0.7" />
        </svg>
      </span>
    );
  }

  if (mode === "other") {
    return (
      <span className="file-thumb-other" title={file.name}>
        <FileTypeIcon path={file.path} />
      </span>
    );
  }

  if (thumb && thumb !== "error") {
    return (
      <img
        src={thumb}
        alt=""
        data-testid="thumb-img"
        className="file-thumb-img"
        onClick={(e) => { e.stopPropagation(); openFile(file.path); }}
      />
    );
  }
  if (thumb === "error") {
    return <span className="file-thumb-error">{mode === "video" ? "🎬" : "🖼"}</span>;
  }
  return <span ref={placeholderRef} className="file-thumb-spinner" />;
}
