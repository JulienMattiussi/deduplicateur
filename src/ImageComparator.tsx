import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateFile, ImageMeta } from "./types";
import { useLang } from "./LangContext";
import { openFile } from "./fileActions";
import type { ComparatorProps } from "./comparatorShared";
import { useComparatorNav, ComparatorShell, MetaBlockBase, MetaField, KeepActions } from "./comparatorShared";
import { useZoomPan } from "./hooks/useZoomPan";

function ImageMetaBlock({ file, meta }: { file: DuplicateFile; meta: ImageMeta | null }) {
  const { t } = useLang();
  return (
    <MetaBlockBase file={file}>
      {meta ? (
        <>
          <MetaField label={t.imageMetaDimensions} value={`${meta.width}×${meta.height}`} />
          <MetaField label={t.imageMetaFormat} value={meta.format} />
          {meta.exif_date && (
            <MetaField label={t.imageMetaExifDate} value={meta.exif_date} />
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
  onKeepNext,
  onKeepClose,
  transform,
  cursor,
  onWheel,
  onMouseDown,
  onImageClick,
}: {
  file: DuplicateFile;
  thumb: string | null;
  meta: ImageMeta | null;
  kept: boolean;
  onKeepNext: () => void;
  onKeepClose: () => void;
  transform: string;
  cursor: string;
  onWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onImageClick: (path: string) => void;
}) {
  return (
    <div className="comparator-panel">
      <div
        className="comparator-image-area"
        style={{ cursor }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
      >
        {!thumb && <span className="file-thumb-spinner comparator-spin" />}
        {thumb === "error" && <span className="comparator-thumb-error">🖼</span>}
        {thumb && thumb !== "error" && (
          <img
            src={thumb}
            alt={file.name}
            className="comparator-img"
            style={{ transform, transformOrigin: "0 0" }}
            onClick={() => onImageClick(file.path)}
            draggable={false}
          />
        )}
      </div>
      <div className="comparator-footer">
        <KeepActions kept={kept} onKeepNext={onKeepNext} onKeepClose={onKeepClose} />
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
  onIgnore,
  onClose,
}: ComparatorProps) {
  const { t } = useLang();
  const nav = useComparatorNav({ groups, startIdx, selected, onSelectPaths, onIgnore, onClose });
  const [overlayMode, setOverlayMode] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [leftThumb, setLeftThumb] = useState<string | null>(null);
  const [rightThumb, setRightThumb] = useState<string | null>(null);
  const [leftMeta, setLeftMeta] = useState<ImageMeta | null>(null);
  const [rightMeta, setRightMeta] = useState<ImageMeta | null>(null);
  const sliderWrapRef = useRef<HTMLDivElement>(null);

  // Zoom + pan partages entre les deux <img> via le hook. Le state vit dans
  // ce composant et est reset au close+reopen du comparateur.
  const { transform, cursor, handleWheel, handleMouseDown, wasDragged } = useZoomPan();

  function handleImageClick(filePath: string) {
    if (wasDragged()) return;
    openFile(filePath);
  }

  // Memorise les paths affiches au precedent render pour savoir lequel a change.
  // Necessaire car le useEffect ci-dessous depend des deux indices : sans ca on
  // ne pourrait pas distinguer "left a change" de "right a change" et on devrait
  // toujours reset les deux cotes (regression UX pour les images statiques).
  const prevPaths = useRef({ left: "", right: "" });

  // Compteur incrementé a chaque "reset" pour les groupes contenant un GIF :
  // ajoute en fragment URL `#_remount=N` aux deux sources pour forcer le browser
  // a considerer chaque load comme une URL distincte. Sans ca, WebView2 (Windows)
  // reutilise l'image GIF deja decodee et l'animation continue (le reset+refetch
  // de la src identique ne suffit pas a faire redemarrer l'animation a frame 0).
  const gifTickRef = useRef(0);

  useEffect(() => {
    if (!nav.hasValidGroup) return;

    const lf = nav.group.files[nav.effectiveLeftIdx];
    const rf = nav.group.files[nav.effectiveRightIdx];
    const leftChanged = prevPaths.current.left !== lf.path;
    const rightChanged = prevPaths.current.right !== rf.path;
    if (!leftChanged && !rightChanged) return;
    prevPaths.current = { left: lf.path, right: rf.path };

    setSliderPos(50);

    // Si le groupe contient au moins un GIF anime, on reset ET re-fetch les
    // deux cotes ensemble pour resynchroniser les animations. Les `<img>`
    // HTML5 n'ont pas d'API JS pour controler la position d'animation, et
    // sous WebView2 (Windows) la cle React seule ne suffit pas a forcer le
    // remount si la `src` est inchangee. Reset des thumbs a null -> les `<img>`
    // sont vraiment retires du DOM (condition de rendu false), puis re-fetch
    // les deux URLs en parallele et setLeftThumb + setRightThumb dans le meme
    // `.then()` -> React batche les setState -> les deux balises remontent
    // dans le meme tick -> les deux GIF demarrent ensemble.
    //
    // Pour les groupes sans GIF, on garde la granularite : on ne reset que le
    // cote qui a vraiment change. Pas de clignotement parasite sur l'autre.
    const groupHasGif = nav.group.files.some(f =>
      f.path.toLowerCase().endsWith(".gif")
    );

    if (groupHasGif) {
      const tick = ++gifTickRef.current;

      // Phase 1 : reset les thumbs a null pour que les <img> sortent du DOM via
      // la condition de rendu. React commit ce render apres le useEffect courant.
      setLeftThumb(null);
      setRightThumb(null);
      setLeftMeta(null);
      setRightMeta(null);

      // Phase 2 : attendre 2 frames pour garantir un paint browser de l'etat
      // "img absent" avant de remettre les URLs. React 18 batche les renders et
      // WebView2 saute le paint intermediaire si les deux setState arrivent dans
      // la meme frame -> constate empiriquement "pas meme un clignotement", l'<img>
      // n'est jamais vraiment retire visuellement, et WebView2 reprend l'animation
      // en cours.
      Promise.all([
        invoke<string>("get_image_url", { path: lf.path, maxSize: 800 }).catch(() => "error"),
        invoke<string>("get_image_url", { path: rf.path, maxSize: 800 }).catch(() => "error"),
      ]).then(([leftUrl, rightUrl]) => {
        // Append un query param pour que WebView2 considere chaque load comme
        // une URL distincte au niveau du cache HTTP. Le fragment `#...` ne
        // suffit pas : WebView2 normalise l'URL (strip le fragment) avant la
        // lookup cache -> meme cle -> meme animation en cours. Le query, lui,
        // fait partie de la cle de cache. Le media server ignore les query
        // params (lit uniquement `uri().path()`) donc transparent cote backend.
        // Pour les data URLs (non-GIF dans un groupe mixte), on utilise un
        // fragment a la place (les query params n'ont pas de semantique dans
        // les data URLs).
        const withTick = (url: string) => {
          if (url === "error") return url;
          if (url.startsWith("http://") || url.startsWith("https://")) {
            const sep = url.includes("?") ? "&" : "?";
            return `${url}${sep}_remount=${tick}`;
          }
          return `${url}#_remount=${tick}`;
        };
        const leftTagged = withTick(leftUrl);
        const rightTagged = withTick(rightUrl);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setLeftThumb(leftTagged);
            setRightThumb(rightTagged);
          });
        });
      });
      invoke<ImageMeta>("get_image_meta", { path: lf.path }).then(setLeftMeta).catch(() => {});
      invoke<ImageMeta>("get_image_meta", { path: rf.path }).then(setRightMeta).catch(() => {});
      return;
    }

    if (leftChanged) {
      setLeftThumb(null);
      setLeftMeta(null);
      invoke<string>("get_image_url", { path: lf.path, maxSize: 800 })
        .then(setLeftThumb).catch(() => setLeftThumb("error"));
      invoke<ImageMeta>("get_image_meta", { path: lf.path })
        .then(setLeftMeta).catch(() => {});
    }
    if (rightChanged) {
      setRightThumb(null);
      setRightMeta(null);
      invoke<string>("get_image_url", { path: rf.path, maxSize: 800 })
        .then(setRightThumb).catch(() => setRightThumb("error"));
      invoke<ImageMeta>("get_image_meta", { path: rf.path })
        .then(setRightMeta).catch(() => {});
    }
  }, [nav.groupIdx, nav.effectiveLeftIdx, nav.effectiveRightIdx, nav.hasValidGroup, nav.group]);

  if (!nav.hasValidGroup) return null;

  const { leftFile, rightFile, keepFile, isKept } = nav;

  function onSliderMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation(); // empeche que le mousedown declenche le drag-pan du parent
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
            kept={isKept(leftFile)}
            onKeepNext={() => keepFile(leftFile.path, true)}
            onKeepClose={() => keepFile(leftFile.path, false)}
            transform={transform} cursor={cursor}
            onWheel={handleWheel} onMouseDown={handleMouseDown}
            onImageClick={handleImageClick}
          />
          <div className="comparator-divider" />
          <ImagePanel
            file={rightFile} thumb={rightThumb} meta={rightMeta}
            kept={isKept(rightFile)}
            onKeepNext={() => keepFile(rightFile.path, true)}
            onKeepClose={() => keepFile(rightFile.path, false)}
            transform={transform} cursor={cursor}
            onWheel={handleWheel} onMouseDown={handleMouseDown}
            onImageClick={handleImageClick}
          />
        </div>
      ) : (
        <div className="comparator-body comparator-body--overlay" data-testid="comparator-body-overlay">
          <div
            className="comparator-slider-wrap"
            ref={sliderWrapRef}
            style={{ cursor }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
          >
            {leftThumb && leftThumb !== "error" && (
              <img
                src={leftThumb}
                className="comparator-overlay-img"
                alt={leftFile.name}
                style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)`, transform, transformOrigin: "0 0" }}
                draggable={false}
              />
            )}
            {rightThumb && rightThumb !== "error" && (
              <img
                src={rightThumb}
                className="comparator-overlay-img"
                alt={rightFile.name}
                style={{ clipPath: `inset(0 0 0 ${sliderPos}%)`, transform, transformOrigin: "0 0" }}
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
              <KeepActions
                kept={isKept(leftFile)}
                onKeepNext={() => keepFile(leftFile.path, true)}
                onKeepClose={() => keepFile(leftFile.path, false)}
              />
              <ImageMetaBlock file={leftFile} meta={leftMeta} />
            </div>
            <div className="comparator-overlay-meta-col">
              <KeepActions
                kept={isKept(rightFile)}
                onKeepNext={() => keepFile(rightFile.path, true)}
                onKeepClose={() => keepFile(rightFile.path, false)}
              />
              <ImageMetaBlock file={rightFile} meta={rightMeta} />
            </div>
          </div>
        </div>
      )}
    </ComparatorShell>
  );
}
