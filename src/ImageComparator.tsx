import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateGroup, DuplicateFile, ImageMeta } from "./types";
import { formatSize } from "./utils";
import { useLang } from "./LangContext";

function openFile(path: string) {
  invoke("open_file", { path }).catch(() => {});
}

export function ImageComparator({
  groups,
  startIdx,
  selected,
  onSelectPaths,
  onClose,
}: {
  groups: DuplicateGroup[];
  startIdx: number;
  selected: Set<string>;
  onSelectPaths: (toAdd: string[], toRemove: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [groupIdx, setGroupIdx] = useState(Math.max(0, Math.min(startIdx, groups.length - 1)));
  const [leftFileIdx, setLeftFileIdx] = useState(0);
  const [rightFileIdx, setRightFileIdx] = useState(1);
  const [overlayMode, setOverlayMode] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [leftThumb, setLeftThumb] = useState<string | null>(null);
  const [rightThumb, setRightThumb] = useState<string | null>(null);
  const [leftMeta, setLeftMeta] = useState<ImageMeta | null>(null);
  const [rightMeta, setRightMeta] = useState<ImageMeta | null>(null);
  const sliderWrapRef = useRef<HTMLDivElement>(null);

  const group = groups[groupIdx];
  if (!group || group.files.length < 2) return null;

  const effectiveLeftIdx = Math.min(leftFileIdx, group.files.length - 1);
  const effectiveRightIdx = Math.min(rightFileIdx, group.files.length - 1);
  const leftFile = group.files[effectiveLeftIdx];
  const rightFile = group.files[effectiveRightIdx];

  useEffect(() => {
    setLeftThumb(null);
    setLeftMeta(null);
    setSliderPos(50);
    const lf = group.files[Math.min(leftFileIdx, group.files.length - 1)];
    invoke<string>("get_image_thumbnail", { path: lf.path, maxSize: 800 })
      .then(setLeftThumb).catch(() => setLeftThumb("error"));
    invoke<ImageMeta>("get_image_meta", { path: lf.path })
      .then(setLeftMeta).catch(() => {});
  }, [groupIdx, leftFileIdx]);

  useEffect(() => {
    setRightThumb(null);
    setRightMeta(null);
    const rf = group.files[Math.min(rightFileIdx, group.files.length - 1)];
    invoke<string>("get_image_thumbnail", { path: rf.path, maxSize: 800 })
      .then(setRightThumb).catch(() => setRightThumb("error"));
    invoke<ImageMeta>("get_image_meta", { path: rf.path })
      .then(setRightMeta).catch(() => {});
  }, [groupIdx, rightFileIdx]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inInput = (e.target as HTMLElement).tagName === "INPUT";
      if (inInput) return;
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft") goGroup(-1);
      if (e.key === "ArrowRight") goGroup(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groupIdx, groups.length]);

  function goGroup(delta: number) {
    const next = groupIdx + delta;
    if (next >= 0 && next < groups.length) {
      setGroupIdx(next);
      setLeftFileIdx(0);
      setRightFileIdx(1);
    }
  }

  function pickLeft(i: number) {
    if (i === rightFileIdx) setRightFileIdx(leftFileIdx);
    setLeftFileIdx(i);
  }

  function pickRight(i: number) {
    if (i === leftFileIdx) setLeftFileIdx(rightFileIdx);
    setRightFileIdx(i);
  }

  function keepFile(keepPath: string) {
    const toAdd = group.files.filter((f) => f.path !== keepPath).map((f) => f.path);
    onSelectPaths(toAdd, [keepPath]);
  }

  function isKept(file: DuplicateFile): boolean {
    return (
      !selected.has(file.path) &&
      group.files.filter((f) => f.path !== file.path).every((f) => selected.has(f.path))
    );
  }

  function onSliderMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const wrap = sliderWrapRef.current;
    if (!wrap) return;
    function onMove(ev: MouseEvent) {
      const rect = wrap!.getBoundingClientRect();
      setSliderPos(Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100)));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function MetaBlock({ file, meta }: { file: DuplicateFile; meta: ImageMeta | null }) {
    return (
      <div className="comparator-meta">
        <div className="comparator-meta-row">
          <span className="comparator-meta-label">{t.colName}</span>
          <span className="comparator-meta-value comparator-meta-filename">{file.name}</span>
        </div>
        <div className="comparator-meta-row">
          <span className="comparator-meta-label">{t.colSize}</span>
          <span className="comparator-meta-value">{formatSize(file.size)}</span>
        </div>
        {meta ? (
          <>
            <div className="comparator-meta-row">
              <span className="comparator-meta-label">{t.imageMetaDimensions}</span>
              <span className="comparator-meta-value">{meta.width}×{meta.height}</span>
            </div>
            <div className="comparator-meta-row">
              <span className="comparator-meta-label">{t.imageMetaFormat}</span>
              <span className="comparator-meta-value">{meta.format}</span>
            </div>
            {meta.exif_date && (
              <div className="comparator-meta-row">
                <span className="comparator-meta-label">{t.imageMetaExifDate}</span>
                <span className="comparator-meta-value">{meta.exif_date}</span>
              </div>
            )}
          </>
        ) : (
          <div className="comparator-meta-row">
            <span className="comparator-meta-label" style={{ opacity: 0.5 }}>…</span>
          </div>
        )}
      </div>
    );
  }

  function Panel({ file, thumb, meta }: { file: DuplicateFile; thumb: string | null; meta: ImageMeta | null }) {
    const kept = isKept(file);
    return (
      <div className="comparator-panel">
        <div className="comparator-image-area">
          {!thumb && <span className="file-thumb-spinner comparator-spin" />}
          {thumb === "error" && <span className="comparator-thumb-error">🖼</span>}
          {thumb && thumb !== "error" && (
            <img
              src={thumb}
              alt={file.name}
              className="comparator-img"
              onClick={() => openFile(file.path)}
              draggable={false}
            />
          )}
        </div>
        <div className="comparator-footer">
          <button
            className={`comparator-keep-btn${kept ? " comparator-keep-btn--kept" : ""}`}
            onClick={() => keepFile(file.path)}
          >
            {kept ? "✓ " : ""}{t.keepThis}
          </button>
          <MetaBlock file={file} meta={meta} />
        </div>
      </div>
    );
  }

  return (
    <div className="comparator-overlay">
      <div className="comparator-header">
        <div className="comparator-nav">
          <button className="btn-ghost btn-sm" onClick={() => goGroup(-1)} disabled={groupIdx === 0}>◀</button>
          <span className="comparator-counter">{groupIdx + 1} / {groups.length}</span>
          <button className="btn-ghost btn-sm" onClick={() => goGroup(1)} disabled={groupIdx === groups.length - 1}>▶</button>
        </div>
        <span className="comparator-title">{t.imageComparator}</span>
        <div className="comparator-header-right">
          <button
            className={`btn-ghost btn-sm${overlayMode ? " btn-active" : ""}`}
            onClick={() => setOverlayMode((v) => !v)}
            title={t.overlayMode}
          >
            ⧉
          </button>
          <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="comparator-tabs">
        <div className="comparator-tabs-group">
          <span className="comparator-tabs-side">{t.panelLeft}</span>
          {group.files.map((f, i) => (
            <button
              key={`l${i}`}
              className={`comparator-tab${effectiveLeftIdx === i ? " comparator-tab--active" : ""}`}
              onClick={() => pickLeft(i)}
              title={f.name}
            >
              {f.name}
            </button>
          ))}
        </div>
        <div className="comparator-tabs-group">
          <span className="comparator-tabs-side">{t.panelRight}</span>
          {group.files.map((f, i) => (
            <button
              key={`r${i}`}
              className={`comparator-tab${effectiveRightIdx === i ? " comparator-tab--active" : ""}`}
              onClick={() => pickRight(i)}
              title={f.name}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      {!overlayMode ? (
        <div className="comparator-body">
          <Panel file={leftFile} thumb={leftThumb} meta={leftMeta} />
          <div className="comparator-divider" />
          <Panel file={rightFile} thumb={rightThumb} meta={rightMeta} />
        </div>
      ) : (
        <div className="comparator-body comparator-body--overlay">
          <div className="comparator-slider-wrap" ref={sliderWrapRef}>
            {leftThumb && leftThumb !== "error" && (
              <img
                src={leftThumb}
                className="comparator-overlay-img"
                alt={leftFile.name}
                style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                draggable={false}
              />
            )}
            {rightThumb && rightThumb !== "error" && (
              <img
                src={rightThumb}
                className="comparator-overlay-img"
                alt={rightFile.name}
                style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
                draggable={false}
              />
            )}
            <div
              className="comparator-slider-handle"
              style={{ left: `${sliderPos}%` }}
              onMouseDown={onSliderMouseDown}
            >
              <div className="comparator-slider-circle" />
            </div>
          </div>
          <div className="comparator-overlay-meta">
            <div className="comparator-overlay-meta-col">
              <button
                className={`comparator-keep-btn${isKept(leftFile) ? " comparator-keep-btn--kept" : ""}`}
                onClick={() => keepFile(leftFile.path)}
              >
                {isKept(leftFile) ? "✓ " : ""}{t.keepThis}
              </button>
              <MetaBlock file={leftFile} meta={leftMeta} />
            </div>
            <div className="comparator-overlay-meta-col">
              <button
                className={`comparator-keep-btn${isKept(rightFile) ? " comparator-keep-btn--kept" : ""}`}
                onClick={() => keepFile(rightFile.path)}
              >
                {isKept(rightFile) ? "✓ " : ""}{t.keepThis}
              </button>
              <MetaBlock file={rightFile} meta={rightMeta} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
