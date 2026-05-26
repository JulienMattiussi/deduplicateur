import { useState, useEffect, useRef, useCallback } from "react";
import type { DuplicateGroup, DuplicateFile } from "./types";
import { formatSize, dirname } from "./utils";
import { useLang } from "./LangContext";
import { revealInFolder, openFile } from "./fileActions";

/**
 * Groupe d'onglets scrollables (cote Gauche ou Droite). Affiche des fleches
 * de scroll laterales quand les onglets debordent de la largeur disponible.
 * Les fleches sont automatiquement cachees quand tout rentre, et grisees
 * quand on est aux bornes du scroll. Le scroll lui-meme reste possible au
 * trackpad / molette horizontale.
 */
export function ScrollableTabsGroup({
  side,
  label,
  testIdPrefix = "tabs",
  children,
}: {
  side: "left" | "right";
  label: string;
  testIdPrefix?: string;
  children: React.ReactNode;
}) {
  const scrollableRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // True si la largeur naturelle des onglets depasse la largeur dispo (= il y
  // a de l'overflow). Permet de cacher completement les fleches quand tout
  // rentre, evitant la pollution visuelle pour les groupes a 2-3 fichiers.
  const [hasOverflow, setHasOverflow] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollableRef.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 1;
    setHasOverflow(overflow);
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollableRef.current;
    if (!el) return;
    checkScroll();
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    el.addEventListener("scroll", checkScroll);
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", checkScroll);
    };
  }, [checkScroll]);

  // Re-check au changement de contenu (nouveau groupe affiche -> nombre
  // d'onglets different).
  useEffect(() => {
    checkScroll();
  }, [children, checkScroll]);

  function scrollByDelta(delta: number) {
    scrollableRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    <div className="comparator-tabs-group" data-testid={`${testIdPrefix}-${side}`}>
      <span className="comparator-tabs-side">{label}</span>
      {hasOverflow && (
        <button
          className="comparator-tabs-scroll-btn"
          disabled={!canScrollLeft}
          onClick={() => scrollByDelta(-200)}
          data-testid={`${testIdPrefix}-${side}-scroll-left`}
          aria-label="Scroll left"
        >◀</button>
      )}
      <div className="comparator-tabs-scrollable" ref={scrollableRef}>
        {children}
      </div>
      {hasOverflow && (
        <button
          className="comparator-tabs-scroll-btn"
          disabled={!canScrollRight}
          onClick={() => scrollByDelta(200)}
          data-testid={`${testIdPrefix}-${side}-scroll-right`}
          aria-label="Scroll right"
        >▶</button>
      )}
    </div>
  );
}

/**
 * Construit une URL pour le serveur media local (audio/video) a partir d'un chemin disque.
 * Normalise les separateurs Windows et URI-encode chaque segment.
 */
export function toMediaUrl(path: string, port: number): string {
  const normalized = path.replace(/\\/g, "/");
  const withSlash = normalized.startsWith("/") ? normalized : "/" + normalized;
  return `http://127.0.0.1:${port}${withSlash.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Ligne de meta partagee par tous les MetaBlock (Image/Video/Audio/Archive) :
 * un label aligne a gauche, une valeur a droite, structure DOM unique pour
 * eviter la duplication de `<div className="comparator-meta-row">...</div>`
 * dans chaque comparateur. `label` et `value` acceptent du markup React pour
 * les cas avec contenu dynamique (ex. nombre de pistes audio dans le label,
 * liste de spans dans la valeur).
 */
export function MetaField({
  label,
  value,
  valueClassName,
  valueStyle,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  valueClassName?: string;
  valueStyle?: React.CSSProperties;
}) {
  const className = valueClassName ? `comparator-meta-value ${valueClassName}` : "comparator-meta-value";
  return (
    <div className="comparator-meta-row">
      <span className="comparator-meta-label">{label}</span>
      <span className={className} style={valueStyle}>{value}</span>
    </div>
  );
}

/**
 * Bouton "Garder celui-ci" partage par les comparateurs Image/Video/Audio.
 * Affiche un coche (✓) prefixe quand le fichier est marque comme garde.
 */
export function KeepButton({ kept, onKeep }: { kept: boolean; onKeep: () => void }) {
  const { t } = useLang();
  return (
    <button
      className={`comparator-keep-btn${kept ? " comparator-keep-btn--kept" : ""}`}
      onClick={onKeep}
    >
      {kept ? "✓ " : ""}{t.keepThis}
    </button>
  );
}

export interface ComparatorProps {
  groups: DuplicateGroup[];
  startIdx: number;
  selected: Set<string>;
  onSelectPaths: (toAdd: string[], toRemove: string[]) => void;
  onClose: () => void;
}

export interface ComparatorNav {
  groupIdx: number;
  group: DuplicateGroup;
  hasValidGroup: boolean;
  effectiveLeftIdx: number;
  effectiveRightIdx: number;
  leftFile: DuplicateFile;
  rightFile: DuplicateFile;
  goGroup: (delta: number) => void;
  pickLeft: (i: number) => void;
  pickRight: (i: number) => void;
  keepFile: (keepPath: string) => void;
  isKept: (file: DuplicateFile) => boolean;
}

export function useComparatorNav({
  groups,
  startIdx,
  selected,
  onSelectPaths,
  onClose,
}: ComparatorProps): ComparatorNav {
  const [groupIdx, setGroupIdx] = useState(Math.max(0, Math.min(startIdx, groups.length - 1)));
  const [leftFileIdx, setLeftFileIdx] = useState(0);
  const [rightFileIdx, setRightFileIdx] = useState(1);

  const group = groups[groupIdx];
  const hasValidGroup = !!(group && group.files.length >= 2);
  const effectiveLeftIdx = hasValidGroup ? Math.min(leftFileIdx, group.files.length - 1) : 0;
  const effectiveRightIdx = hasValidGroup ? Math.min(rightFileIdx, group.files.length - 1) : 1;

  function goGroup(delta: number) {
    const next = groupIdx + delta;
    if (next >= 0 && next < groups.length) {
      setGroupIdx(next);
      setLeftFileIdx(0);
      setRightFileIdx(1);
    }
  }

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
  }, [groupIdx, groups.length, onClose]);

  function pickLeft(i: number) {
    if (i === rightFileIdx) setRightFileIdx(leftFileIdx);
    setLeftFileIdx(i);
  }

  function pickRight(i: number) {
    if (i === leftFileIdx) setLeftFileIdx(rightFileIdx);
    setRightFileIdx(i);
  }

  function keepFile(keepPath: string) {
    if (!group) return;
    const toAdd = group.files.filter((f) => f.path !== keepPath).map((f) => f.path);
    onSelectPaths(toAdd, [keepPath]);
    onClose();
  }

  function isKept(file: DuplicateFile): boolean {
    if (!group) return false;
    return (
      !selected.has(file.path) &&
      group.files.filter((f) => f.path !== file.path).every((f) => selected.has(f.path))
    );
  }

  return {
    groupIdx,
    group,
    hasValidGroup,
    effectiveLeftIdx,
    effectiveRightIdx,
    leftFile: group?.files[effectiveLeftIdx] ?? group?.files[0],
    rightFile: group?.files[effectiveRightIdx] ?? group?.files[1],
    goGroup,
    pickLeft,
    pickRight,
    keepFile,
    isKept,
  };
}

/**
 * Pattern "deux groupes d'onglets de selection cote a cote" partage par
 * tous les comparateurs (fichier dans ComparatorShell, archive dans
 * ArchiveComparator). Encapsule :
 * - le wrapper `<div className="comparator-tabs">`
 * - les deux `ScrollableTabsGroup` gauche/droite
 * - le rendu des onglets (boutons avec etat actif)
 *
 * Toute modification de la mecanique des onglets (scroll, styling, etc.)
 * se propage automatiquement aux deux comparateurs.
 */
export function DualScrollableTabs<T>({
  items,
  leftIdx,
  rightIdx,
  onPickLeft,
  onPickRight,
  getLabel,
  leftSideLabel,
  rightSideLabel,
  testIdPrefix = "tabs",
}: {
  items: T[];
  leftIdx: number;
  rightIdx: number;
  onPickLeft: (i: number) => void;
  onPickRight: (i: number) => void;
  getLabel: (item: T, i: number) => string;
  leftSideLabel: string;
  rightSideLabel: string;
  testIdPrefix?: string;
}) {
  return (
    <div className="comparator-tabs">
      <ScrollableTabsGroup side="left" label={leftSideLabel} testIdPrefix={testIdPrefix}>
        {items.map((item, i) => {
          const label = getLabel(item, i);
          return (
            <button
              key={`l${i}`}
              className={`comparator-tab${leftIdx === i ? " comparator-tab--active" : ""}`}
              onClick={() => onPickLeft(i)}
              title={label}
            >{label}</button>
          );
        })}
      </ScrollableTabsGroup>
      <ScrollableTabsGroup side="right" label={rightSideLabel} testIdPrefix={testIdPrefix}>
        {items.map((item, i) => {
          const label = getLabel(item, i);
          return (
            <button
              key={`r${i}`}
              className={`comparator-tab${rightIdx === i ? " comparator-tab--active" : ""}`}
              onClick={() => onPickRight(i)}
              title={label}
            >{label}</button>
          );
        })}
      </ScrollableTabsGroup>
    </div>
  );
}

export function ComparatorShell({
  nav,
  groups,
  title,
  headerExtra,
  onClose,
  children,
}: {
  nav: ComparatorNav;
  groups: DuplicateGroup[];
  title: string;
  headerExtra?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useLang();
  const { groupIdx, group, effectiveLeftIdx, effectiveRightIdx, goGroup, pickLeft, pickRight } = nav;
  return (
    <div className="comparator-overlay">
      <div className="comparator-header">
        <div className="comparator-nav">
          <button className="btn-ghost btn-sm" onClick={() => goGroup(-1)} disabled={groupIdx === 0}>◀</button>
          <span className="comparator-counter">{groupIdx + 1} / {groups.length}</span>
          <button className="btn-ghost btn-sm" onClick={() => goGroup(1)} disabled={groupIdx === groups.length - 1}>▶</button>
        </div>
        <span className="comparator-title">{title}</span>
        <div className="comparator-header-right">
          {headerExtra}
          <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
      </div>

      <DualScrollableTabs
        items={group.files}
        leftIdx={effectiveLeftIdx}
        rightIdx={effectiveRightIdx}
        onPickLeft={pickLeft}
        onPickRight={pickRight}
        getLabel={(f) => f.name}
        leftSideLabel={t.panelLeft}
        rightSideLabel={t.panelRight}
      />

      {children}
    </div>
  );
}

export function MetaBlockBase({
  file,
  children,
}: {
  file: DuplicateFile;
  children?: React.ReactNode;
}) {
  const { t } = useLang();
  return (
    <div className="comparator-meta">
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colName}</span>
        <span className="comparator-meta-value comparator-meta-filename" title={file.name}>{file.name}</span>
        <button
          className="btn-ghost btn-sm comparator-reveal-btn"
          title={t.openFileBtn}
          onClick={() => openFile(file.path)}
          data-testid="comparator-open-file-btn"
        >
          ⏵
        </button>
      </div>
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colFolder}</span>
        <span className="comparator-meta-value comparator-meta-path" title={file.path}>{dirname(file.path)}</span>
        <button
          className="btn-ghost btn-sm comparator-reveal-btn"
          title={t.revealInFolderBtn}
          onClick={() => revealInFolder(file.path)}
        >
          📂
        </button>
      </div>
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colSize}</span>
        <span className="comparator-meta-value">{formatSize(file.size)}</span>
      </div>
      {children}
    </div>
  );
}
