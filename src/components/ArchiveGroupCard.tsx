import { useLang } from "../LangContext";
import type { ArchiveGroupResult } from "../types";

interface Props {
  group: ArchiveGroupResult;
  onViewContent: (pathA: string, pathB: string) => void;
  onDelete: (path: string) => void;
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function ArchiveGroupCard({ group, onViewContent, onDelete }: Props) {
  const { t } = useLang();
  const { archives, shared_entry_count } = group;

  function handleViewContent(a: { path: string }, b: { path: string }) {
    onViewContent(a.path, b.path);
  }

  return (
    <div className="group-card archive-group-card" data-testid="archive-group-card">
      <div className="group-card-header">
        <span className="group-card-title">
          {archives.length} archives - {shared_entry_count} {t.archiveSharedFiles}
        </span>
      </div>
      <div className="group-card-files" data-testid="archive-group-files">
        {archives.map((archive, idx) => (
          <div key={archive.path} className="archive-entry">
            <span className="archive-entry-name" title={archive.path}>
              {basename(archive.path)}
            </span>
            {archive.can_delete && (
              <span className="badge badge-ref archive-badge-deletable">{t.archiveCanDelete}</span>
            )}
            <span className="archive-entry-count">
              {archive.duplicated_entries}/{archive.total_entries} {t.archiveEntries}
            </span>
            {archives.length === 2 && idx === 0 && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => handleViewContent(archives[0], archives[1])}
              >
                {t.archiveViewContent}
              </button>
            )}
            {archives.length > 2 && (
              <span className="archive-pairs">
                {archives
                  .filter((other) => other.path !== archive.path)
                  .map((other) => (
                    <button
                      key={other.path}
                      className="btn btn-ghost btn-sm"
                      title={`${basename(archive.path)} vs ${basename(other.path)}`}
                      onClick={() => handleViewContent(archive, other)}
                    >
                      {t.archiveViewContent} vs {basename(other.path)}
                    </button>
                  ))}
              </span>
            )}
            {archive.can_delete && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => onDelete(archive.path)}
                data-testid="archive-delete-btn"
              >
                {t.confirmConfirm}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
