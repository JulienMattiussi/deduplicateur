import { useRef, useState, useEffect } from "react";
import { useLang } from "../LangContext";
import { ScanProfile } from "../types";

interface ProfilesPanelProps {
  profiles: ScanProfile[];
  currentFolder: string;
  onSave: (name: string) => void;
  onLoad: (profile: ScanProfile) => void;
  onLaunch: (profile: ScanProfile) => void;
  onDelete: (id: string) => void;
  disabled: boolean;
}

export function ProfilesPanel({ profiles, currentFolder, onSave, onLoad, onLaunch, onDelete, disabled }: ProfilesPanelProps) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleSave() {
    const name = nameInput.trim();
    if (!name) return;
    onSave(name);
    setNameInput("");
  }

  return (
    <div className="profiles-container" ref={containerRef}>
      <button className="btn-ghost" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        {t.profiles}
        {profiles.length > 0 && <span className="profiles-badge">{profiles.length}</span>}
      </button>
      {open && (
        <div className="profiles-dropdown">
          <div className="profiles-save-row">
            <input
              className="exclusions-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder={t.profileNamePlaceholder}
              disabled={!currentFolder}
            />
            <button
              className="btn-ghost btn-sm"
              onClick={handleSave}
              disabled={!nameInput.trim() || !currentFolder}
            >
              {t.saveProfile}
            </button>
          </div>
          {profiles.length === 0 ? (
            <p className="profiles-empty">{t.noProfiles}</p>
          ) : (
            <div className="profiles-list">
              {profiles.map((p) => (
                <div key={p.id} className="profile-row">
                  <div className="profile-info">
                    <span className="profile-name">{p.name}</span>
                    <span className="profile-folder">{p.folder}</span>
                  </div>
                  <div className="profile-actions">
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => { onLoad(p); setOpen(false); }}
                      disabled={disabled}
                      title={t.profileLoad}
                    >
                      {t.profileLoad}
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => { onLaunch(p); setOpen(false); }}
                      disabled={disabled}
                      title={t.profileLaunch}
                    >
                      ▶
                    </button>
                    <button
                      className="chip-remove"
                      onClick={() => onDelete(p.id)}
                      title={t.sessionDelete}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
