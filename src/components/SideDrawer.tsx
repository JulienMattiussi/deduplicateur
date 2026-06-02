import { useEffect } from "react";

/**
 * Panneau lateral generique : glisse depuis la droite, pleine hauteur, avec un
 * overlay semi-transparent derriere. Fermeture par le bouton ✕, la touche Echap,
 * ou un clic sur l'overlay.
 *
 * Structure : header (titre + close), `toolbar` optionnelle (recherche/tri),
 * corps scrollable (`children`), `footer` optionnel (actions globales).
 *
 * Partage par IgnoredPanel et ProfilesPanel pour une UI coherente.
 */
export function SideDrawer({
  open,
  onClose,
  title,
  toolbar,
  footer,
  testId,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
  /** Classe additionnelle sur le conteneur (ex. largeur réduite). */
  className?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="side-drawer-overlay" onClick={onClose} />
      <div className={`side-drawer${className ? ` ${className}` : ""}`} data-testid={testId}>
        <div className="side-drawer-header">
          <span className="side-drawer-title">{title}</span>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {toolbar && <div className="side-drawer-toolbar">{toolbar}</div>}
        <div className="side-drawer-body">{children}</div>
        {footer && <div className="side-drawer-footer">{footer}</div>}
      </div>
    </>
  );
}
