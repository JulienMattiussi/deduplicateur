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
  onKeep: () => void;
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
        <KeepButton kept={kept} onKeep={onKeep} />
        <ImageMetaBlock file={file} meta={meta} />
      </div>
    </div>
  );
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 10;
const ZOOM_FACTOR = 1.2;
const DRAG_THRESHOLD_PX = 3;

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

  // Zoom + pan partages entre les deux <img>. Le state vit dans ce composant
  // et est reset au close+reopen du comparateur (useState(...) ré-initialise au mount).
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  // True si la souris a bouge de plus de DRAG_THRESHOLD_PX depuis le mousedown.
  // Utilise pour distinguer un clic (ouvrir le fichier) d'un drag (deplacer l'image).
  const draggedRef = useRef(false);

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    setZoom(prevZoom => {
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prevZoom * factor));
      setPan(prevPan => {
        if (newZoom <= ZOOM_MIN) return { x: 0, y: 0 };
        // Pour que le point image sous le curseur reste sous le curseur apres zoom :
        // newPan = cursor - (cursor - prevPan) * (newZoom / prevZoom)
        const ratio = newZoom / prevZoom;
        return {
          x: cursorX - (cursorX - prevPan.x) * ratio,
          y: cursorY - (cursorY - prevPan.y) * ratio,
        };
      });
      return newZoom;
    });
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (zoom <= ZOOM_MIN) return;
    e.preventDefault();
    draggedRef.current = false;
    setDragging(true);
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, panX: pan.x, panY: pan.y };
  }

  function handleImageClick(filePath: string) {
    // Si l'utilisateur a draggue, le mouseup -> click qui suit ne doit PAS
    // ouvrir le fichier. On consomme le flag puis on sort.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    openFile(filePath);
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const dx = e.clientX - dragStart.current.mouseX;
      const dy = e.clientY - dragStart.current.mouseY;
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX) {
        draggedRef.current = true;
      }
      setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
    }
    function onUp() {
      setDragging(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  const cursor = zoom > ZOOM_MIN ? (dragging ? "grabbing" : "grab") : "default";

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
            kept={isKept(leftFile)} onKeep={() => keepFile(leftFile.path)}
            transform={transform} cursor={cursor}
            onWheel={handleWheel} onMouseDown={handleMouseDown}
            onImageClick={handleImageClick}
          />
          <div className="comparator-divider" />
          <ImagePanel
            file={rightFile} thumb={rightThumb} meta={rightMeta}
            kept={isKept(rightFile)} onKeep={() => keepFile(rightFile.path)}
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
