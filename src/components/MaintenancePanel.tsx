import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLang } from "../LangContext";
import { interp, pluralInterp } from "../i18n";
import { formatSize, basename } from "../utils";
import { SideDrawer } from "./SideDrawer";
import type { MaintenanceReport, SessionMaintenanceInfo } from "../types";

const DAY_MS = 86_400_000;

/**
 * Menu Maintenance (drawer lateral). Regroupe l'entretien long terme en trois
 * blocs du moins au plus destructeur :
 *  1. Espace occupe (lecture seule)
 *  2. Purge ciblee des references obsoletes (caches + ignores), avec garde-fou
 *     volume cote backend : un disque debranche est preserve.
 *  3. Liste des analyses avec cases a cocher (dossier disparu pre-signale,
 *     selecteur "plus de N jours") + suppression.
 *  4. Vidage complet des caches (option nucleaire heritee de purge_cache).
 *
 * `onChanged` est appele apres toute mutation pour que App rafraichisse la liste
 * des sessions, les compteurs et la liste d'ignores.
 */
export function MaintenancePanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<MaintenanceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [olderDays, setOlderDays] = useState(90);
  const [confirmFullPurge, setConfirmFullPurge] = useState(false);
  const [confirmDeleteSessions, setConfirmDeleteSessions] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await invoke<MaintenanceReport>("get_maintenance_report");
      setReport(r);
    } catch {
      // non-fatal : pas de rapport, le drawer reste vide.
    }
  }, []);

  function openPanel() {
    setOpen(true);
    setSelected(new Set());
    setConfirmFullPurge(false);
    setConfirmDeleteSessions(false);
    setReport(null);
    load();
  }

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await load();
      onChanged();
    } catch {
      // non-fatal
    } finally {
      setBusy(false);
    }
  }

  const cleanCaches = () => run(() => invoke("purge_stale_caches"));
  const cleanIgnored = () => run(() => invoke("purge_stale_ignored"));
  const fullPurge = () =>
    run(async () => {
      await invoke("purge_cache");
      setConfirmFullPurge(false);
    });

  const sessions = report?.sessions ?? [];

  function toggleSession(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addToSelection(predicate: (s: SessionMaintenanceInfo) => boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of sessions) if (predicate(s)) next.add(s.id);
      return next;
    });
  }

  const selectAll = () => addToSelection(() => true);
  const selectMissing = () => addToSelection((s) => s.folder_missing);
  const selectOlder = () =>
    addToSelection((s) => Date.now() - parseInt(s.id) > olderDays * DAY_MS);
  const clearSelection = () => setSelected(new Set());

  const deleteSelected = () =>
    run(async () => {
      const ids = [...selected];
      await Promise.all(ids.map((id) => invoke("delete_session", { id })));
      setSelected(new Set());
      setConfirmDeleteSessions(false);
    });

  return (
    <div className="maintenance-container" data-testid="maintenance-panel">
      <button className="btn-ghost help-btn" onClick={openPanel} data-tooltip={t.maintenance} aria-label={t.maintenance}>
        🔧
      </button>
      <SideDrawer
        open={open}
        onClose={() => setOpen(false)}
        testId="maintenance-drawer"
        className="side-drawer--narrow"
        title={`🔧 ${t.maintenance}`}
      >
        {/* Bloc 1 : espace occupe */}
        <section className="maint-section">
          <h3 className="maint-section-title">{t.maintSpaceTitle}</h3>
          {report && (
            <ul className="maint-stats">
              <li>
                <span>{t.maintCacheLabel}</span>
                <span>
                  {formatSize(report.cache_bytes)} ·{" "}
                  {interp(t.maintEntriesN, { n: report.cache_total_entries })}
                </span>
              </li>
              <li>
                <span>{t.maintIgnoredLabel}</span>
                <span>{report.ignored_total}</span>
              </li>
              <li>
                <span>{t.maintSessionsCount}</span>
                <span>{sessions.length}</span>
              </li>
            </ul>
          )}
        </section>

        {/* Bloc 2 : references obsoletes */}
        <section className="maint-section">
          <h3 className="maint-section-title">{t.maintStaleTitle}</h3>
          <p className="maint-hint">{t.maintStaleIntro}</p>
          {report && (
            <>
              <div className="maint-stale-row">
                <span>
                  {t.maintCacheLabel} :{" "}
                  {interp(t.maintCacheStale, {
                    stale: report.cache_stale_entries,
                    total: report.cache_total_entries,
                  })}
                </span>
                <button
                  className="btn-ghost btn-sm"
                  disabled={busy || report.cache_stale_entries === 0}
                  onClick={cleanCaches}
                  data-testid="maint-clean-caches"
                >
                  {report.cache_stale_entries === 0 ? t.maintNothingStale : t.maintClean}
                </button>
              </div>
              <div className="maint-stale-row">
                <span>
                  {t.maintIgnoredLabel} :{" "}
                  {interp(t.maintIgnoredStale, {
                    stale: report.ignored_stale,
                    total: report.ignored_total,
                  })}
                </span>
                <button
                  className="btn-ghost btn-sm"
                  disabled={busy || report.ignored_stale === 0}
                  onClick={cleanIgnored}
                  data-testid="maint-clean-ignored"
                >
                  {report.ignored_stale === 0 ? t.maintNothingStale : t.maintClean}
                </button>
              </div>
            </>
          )}
        </section>

        {/* Bloc 3 : analyses */}
        <section className="maint-section">
          <h3 className="maint-section-title">{t.maintSessionsTitle}</h3>
          <p className="maint-hint">{t.maintSessionsIntro}</p>
          {sessions.length === 0 ? (
            <p className="maint-empty">{t.maintNoSessions}</p>
          ) : (
            <>
              <div className="maint-session-tools">
                <button className="btn-ghost btn-sm" onClick={selectAll}>
                  {t.maintSelectAllSessions}
                </button>
                <button className="btn-ghost btn-sm" onClick={clearSelection}>
                  {t.maintClearSelection}
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={selectMissing}
                  data-testid="maint-select-missing"
                >
                  {t.maintSelectMissing}
                </button>
              </div>
              <div className="maint-older-row">
                <span>{t.maintSelectOlder}</span>
                <input
                  type="number"
                  min={0}
                  className="maint-older-input"
                  value={olderDays}
                  onChange={(e) => setOlderDays(Math.max(0, parseInt(e.target.value) || 0))}
                  data-testid="maint-older-days"
                />
                <span>{t.maintDaysSuffix}</span>
                <button
                  className="btn-ghost btn-sm"
                  onClick={selectOlder}
                  data-testid="maint-apply-older"
                >
                  {t.maintApplyOlder}
                </button>
              </div>
              <ul className="maint-session-list">
                {sessions.map((s) => (
                  <li key={s.id} className="maint-session-row" data-testid="maint-session-row">
                    <label className="maint-session-label">
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleSession(s.id)}
                        data-testid={`maint-session-check-${s.id}`}
                      />
                      <span className="maint-session-folder" title={s.folder}>
                        📁 {basename(s.folder) || s.folder}
                      </span>
                    </label>
                    <span className="maint-session-meta">
                      {s.folder_missing && (
                        <span className="maint-missing-badge" data-testid="maint-missing-badge">
                          {t.maintFolderMissing}
                        </span>
                      )}
                      {s.total_groups} {s.total_groups > 1 ? t.groups : t.group} ·{" "}
                      {formatSize(s.size_bytes)}
                    </span>
                  </li>
                ))}
              </ul>
              {confirmDeleteSessions ? (
                <div className="maint-confirm">
                  <span>{pluralInterp(t.maintDeleteSessionsConfirm, selected.size)}</span>
                  <div className="maint-confirm-buttons">
                    <button
                      className="btn-ghost btn-sm btn-danger"
                      onClick={deleteSelected}
                      disabled={busy}
                      data-testid="maint-delete-confirm"
                    >
                      {t.maintConfirmYes}
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => setConfirmDeleteSessions(false)}
                    >
                      {t.confirmCancel}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn-ghost btn-sm btn-danger maint-delete-btn"
                  disabled={selected.size === 0 || busy}
                  onClick={() => setConfirmDeleteSessions(true)}
                  data-testid="maint-delete-sessions"
                >
                  {interp(t.maintDeleteSelected, { n: selected.size })}
                </button>
              )}
            </>
          )}
        </section>

        {/* Bloc 4 : vidage complet */}
        <section className="maint-section maint-section--danger">
          <h3 className="maint-section-title">{t.maintFullPurgeTitle}</h3>
          <p className="maint-hint">{t.maintFullPurgeIntro}</p>
          {confirmFullPurge ? (
            <div className="maint-confirm">
              <span>{t.maintFullPurgeConfirm}</span>
              <div className="maint-confirm-buttons">
                <button
                  className="btn-ghost btn-sm btn-danger"
                  onClick={fullPurge}
                  disabled={busy}
                  data-testid="maint-full-purge-confirm"
                >
                  {t.maintConfirmYes}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setConfirmFullPurge(false)}>
                  {t.confirmCancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn-ghost btn-sm btn-danger"
              onClick={() => setConfirmFullPurge(true)}
              data-testid="maint-full-purge"
            >
              {t.maintFullPurge}
            </button>
          )}
        </section>
      </SideDrawer>
    </div>
  );
}
