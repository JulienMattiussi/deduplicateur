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

function FileTypeIcon({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const category: FileCategory = EXT_TO_CATEGORY[ext] ?? "generic";

  return (
    <svg
      className="file-thumb-icon"
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
        stroke="currentColor" strokeWidth="1.3" opacity="0.45"
      />
      <polyline points="13 2 13 9 20 9" stroke="currentColor" strokeWidth="1.3" opacity="0.45" />

      {category === "pdf" && (
        <text x="12" y="17.5" textAnchor="middle" fontSize="5" fill="currentColor"
          fontFamily="monospace" fontWeight="bold" opacity="0.75">PDF</text>
      )}
      {category === "archive" && (<>
        <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="1.3" opacity="0.65" />
        <polyline points="9,14.5 12,17.5 15,14.5" stroke="currentColor" strokeWidth="1.3" opacity="0.65" />
        <line x1="9" y1="19" x2="15" y2="19" stroke="currentColor" strokeWidth="1.3" opacity="0.65" />
      </>)}
      {category === "code" && (
        <text x="12" y="17.5" textAnchor="middle" fontSize="4.5" fill="currentColor"
          fontFamily="monospace" opacity="0.75">{"</>"}</text>
      )}
      {category === "document" && (<>
        <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="8" y1="16" x2="16" y2="16" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="8" y1="19" x2="13" y2="19" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      </>)}
      {category === "spreadsheet" && (<>
        <rect x="7" y="11" width="10" height="8" stroke="currentColor" strokeWidth="1.2" opacity="0.6" fill="none" />
        <line x1="12" y1="11" x2="12" y2="19" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="7" y1="15" x2="17" y2="15" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      </>)}
      {category === "presentation" && (<>
        <rect x="7" y="11" width="10" height="6.5" stroke="currentColor" strokeWidth="1.2" opacity="0.6" fill="none" />
        <line x1="12" y1="17.5" x2="12" y2="20" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        <line x1="9.5" y1="20" x2="14.5" y2="20" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      </>)}
      {category === "generic" && (<>
        <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1" opacity="0.35" />
        <line x1="8" y1="16" x2="14" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.35" />
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
