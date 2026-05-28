import { useState } from "react";
import { useLang } from "../LangContext";
import { ScanProfile } from "../types";
import { SideDrawer } from "./SideDrawer";

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
  const [search, setSearch] = useState("");

  function handleSave() {
    const name = nameInput.trim();
    if (!name) return;
    onSave(name);
    setNameInput("");
  }

  const visibleProfiles = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) => p.name.toLowerCase().includes(q) || p.folder.toLowerCase().includes(q)
    );
  })();

  const toolbar = (
    <>
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
      {profiles.length > 0 && (
        <input
          className="profiles-search filter-input"
          placeholder={t.helpSearch}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="profiles-search"
        />
      )}
    </>
  );

  return (
    <div className="profiles-container">
      <button className="btn-ghost" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        👤 {t.profiles}
        {profiles.length > 0 && <span className="profiles-badge">{profiles.length}</span>}
      </button>
      <SideDrawer
        open={open}
        onClose={() => setOpen(false)}
        testId="profiles-drawer"
        title={`👤 ${t.profiles}${profiles.length > 0 ? ` (${profiles.length})` : ""}`}
        toolbar={toolbar}
      >
        {profiles.length === 0 ? (
          <p className="profiles-empty">{t.noProfiles}</p>
        ) : visibleProfiles.length === 0 ? (
          <p className="profiles-empty">{t.helpNoResults}</p>
        ) : (
          <div className="profiles-list">
            {visibleProfiles.map((p) => (
              <div key={p.id} className="profile-row" data-testid="profile-row">
                <div className="profile-info">
                  <span className="profile-name">{p.name}</span>
                  <span className="profile-folder" title={p.folder}>{p.folder}</span>
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
      </SideDrawer>
    </div>
  );
}
