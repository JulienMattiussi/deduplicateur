import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateFile, ImageMeta } from "./types";
import { useLang } from "./LangContext";
import { openFile } from "./fileActions";
import type { ComparatorProps } from "./comparatorShared";
import { useComparatorNav, ComparatorShell, MetaBlockBase, KeepButton } from "./comparatorShared";

function ImageMetaBlock({ file, meta }: { file: DuplicateFile; meta: ImageMeta | null }) {
  const { t } = useLang();
  return (
    <MetaBlockBase file={file}>
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
    </MetaBlockBase>
  );
}

function ImagePanel({
  file,
  thumb,
  meta,
  kept,
  onKeep,
}: {
  file: DuplicateFile;
  thumb: string | null;
  meta: ImageMeta | null;
  kept: boolean;
  onKeep: () => void;
}) {
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
        <KeepButton kept={kept} onKeep={onKeep} />
        <ImageMetaBlock file={file} meta={meta} />
      </div>
    </div>
  );
}

export function ImageComparator({
  groups,
  startIdx,
  selected,
  onSelectPaths,
  onClose,
}: ComparatorProps) {
  const { t } = useLang();
  const nav = useComparatorNav({ groups, startIdx, selected, onSelectPaths, onClose });
  const [overlayMode, setOverlayMode] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [leftThumb, setLeftThumb] = useState<string | null>(null);
  const [rightThumb, setRightThumb] = useState<string | null>(null);
  const [leftMeta, setLeftMeta] = useState<ImageMeta | null>(null);
  const [rightMeta, setRightMeta] = useState<ImageMeta | null>(null);
  const sliderWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!nav.hasValidGroup) return;
    setLeftThumb(null);
    setLeftMeta(null);
    setSliderPos(50);
    const lf = nav.group.files[nav.effectiveLeftIdx];
    // get_image_url anime les GIF (renvoie l'URL du media server) et retombe sur
    // une data URL JPEG redimensionnee pour les autres formats.
    invoke<string>("get_image_url", { path: lf.path, maxSize: 800 })
      .then(setLeftThumb).catch(() => setLeftThumb("error"));
    invoke<ImageMeta>("get_image_meta", { path: lf.path })
      .then(setLeftMeta).catch(() => {});
  }, [nav.groupIdx, nav.effectiveLeftIdx]);

  useEffect(() => {
    if (!nav.hasValidGroup) return;
    setRightThumb(null);
    setRightMeta(null);
    const rf = nav.group.files[nav.effectiveRightIdx];
    invoke<string>("get_image_url", { path: rf.path, maxSize: 800 })
      .then(setRightThumb).catch(() => setRightThumb("error"));
    invoke<ImageMeta>("get_image_meta", { path: rf.path })
      .then(setRightMeta).catch(() => {});
  }, [nav.groupIdx, nav.effectiveRightIdx]);

  if (!nav.hasValidGroup) return null;

  const { leftFile, rightFile, keepFile, isKept } = nav;

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

  return (
    <ComparatorShell
      nav={nav}
      groups={groups}
      title={t.imageComparator}
      onClose={onClose}
      headerExtra={
        <button
          className={`btn-ghost btn-sm${overlayMode ? " btn-active" : ""}`}
          onClick={() => setOverlayMode((v) => !v)}
          title={t.overlayMode}
        >
          ⧉
        </button>
      }
    >
      {!overlayMode ? (
        <div className="comparator-body" data-testid="comparator-body">
          <ImagePanel
            file={leftFile} thumb={leftThumb} meta={leftMeta}
            kept={isKept(leftFile)} onKeep={() => keepFile(leftFile.path)}
          />
          <div className="comparator-divider" />
          <ImagePanel
            file={rightFile} thumb={rightThumb} meta={rightMeta}
            kept={isKept(rightFile)} onKeep={() => keepFile(rightFile.path)}
          />
        </div>
      ) : (
        <div className="comparator-body comparator-body--overlay" data-testid="comparator-body-overlay">
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
              <KeepButton kept={isKept(leftFile)} onKeep={() => keepFile(leftFile.path)} />
              <ImageMetaBlock file={leftFile} meta={leftMeta} />
            </div>
            <div className="comparator-overlay-meta-col">
              <KeepButton kept={isKept(rightFile)} onKeep={() => keepFile(rightFile.path)} />
              <ImageMetaBlock file={rightFile} meta={rightMeta} />
            </div>
          </div>
        </div>
      )}
    </ComparatorShell>
  );
}
