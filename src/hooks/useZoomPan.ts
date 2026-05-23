import { useState, useEffect, useRef } from "react";

const ZOOM_MIN = 1;
const ZOOM_MAX = 10;
const ZOOM_FACTOR = 1.2;
const DRAG_THRESHOLD_PX = 3;

/**
 * Hook reutilisable pour les comparateurs (images et videos) :
 * - zoom a la molette, centre sur la position du curseur, borne entre 1 et 10x
 * - pan a la souris quand zoom > 1, drag continu
 * - sync entre deux panneaux : le meme `transform` est applique aux deux
 *   elements affiches (puisque les conteneurs ont la meme taille CSS, la
 *   transformation produit un comportement miroir)
 * - reset automatique au unmount du composant qui appelle (close+reopen
 *   du comparateur -> useState reinitialise)
 *
 * Le `wasDragged()` permet aux composants enfants de distinguer un clic
 * d'un drag-suivi-de-relachement (utile pour ne pas declencher l'ouverture
 * du fichier dans le viewer externe quand l'utilisateur drag-pan a zoom > 1).
 */
export function useZoomPan() {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  // True si la souris a bouge de plus de DRAG_THRESHOLD_PX depuis le mousedown.
  const draggedRef = useRef(false);

  function handleWheel(e: React.WheelEvent<HTMLElement>) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    setZoom(prevZoom => {
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prevZoom * factor));
      setPan(prevPan => {
        if (newZoom <= ZOOM_MIN) return { x: 0, y: 0 };
        // Pour que le point sous le curseur reste sous le curseur apres zoom :
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

  function handleMouseDown(e: React.MouseEvent<HTMLElement>) {
    if (zoom <= ZOOM_MIN) return;
    e.preventDefault();
    draggedRef.current = false;
    setDragging(true);
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, panX: pan.x, panY: pan.y };
  }

  /**
   * A appeler depuis un onClick pour savoir si le clic suit un drag-pan.
   * Consomme et reset le flag : si l'utilisateur drag-pan puis relache sans
   * bouger, le mouseup -> click qui suit est filtre. Sinon retourne false
   * (vrai clic).
   */
  function wasDragged(): boolean {
    if (draggedRef.current) {
      draggedRef.current = false;
      return true;
    }
    return false;
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
  // zoom-in (loupe avec +) a zoom=1 pour suggerer visuellement la possibilite
  // de zoomer a la molette. grab/grabbing prend le relais des qu'on est zoome.
  const cursor = zoom > ZOOM_MIN ? (dragging ? "grabbing" : "grab") : "zoom-in";

  return { zoom, transform, cursor, dragging, handleWheel, handleMouseDown, wasDragged };
}
