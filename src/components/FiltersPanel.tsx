import { useState } from "react";
import { useLang } from "../LangContext";

export function FiltersPanel({
  excluded,
  onChangeExcluded,
  excludeExtensions,
  onChangeExclude,
  includeExtensions,
  onChangeInclude,
  minFileSizeKb,
  onChangeMin,
  maxFileSizeKb,
  onChangeMax,
  exactCacheEnabled,
  onChangeCache,
  disabled,
}: {
  excluded: string[];
  onChangeExcluded: (v: string[]) => void;
  excludeExtensions: string[];
  onChangeExclude: (v: string[]) => void;
  includeExtensions: string[];
  onChangeInclude: (v: string[]) => void;
  minFileSizeKb: number;
  onChangeMin: (v: number) => void;
  maxFileSizeKb: number;
  onChangeMax: (v: number) => void;
  exactCacheEnabled: boolean;
  onChangeCache: (v: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [folderInput, setFolderInput] = useState("");
  const [excludeInput, setExcludeInput] = useState("");
  const [includeInput, setIncludeInput] = useState("");

  const activeCount = excluded.length + excludeExtensions.length + includeExtensions.length
    + (minFileSizeKb > 0 ? 1 : 0) + (maxFileSizeKb > 0 ? 1 : 0);

  function addFolder() {
    const name = folderInput.trim();
    if (name && !excluded.includes(name)) onChangeExcluded([...excluded, name]);
    setFolderInput("");
  }

  function addExt(list: string[], input: string, onChange: (v: string[]) => void, setInput: (v: string) => void) {
    const ext = input.trim().replace(/^\./, "").toLowerCase();
    if (ext && !list.includes(ext)) onChange([...list, ext]);
    setInput("");
  }

  return (
    <div className="exclusions">
      <button className="exclusions-toggle" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <span>{open ? "▾" : "▸"}</span>
        {t.filtersPanel}
        <span className="exclusions-count">{activeCount}</span>
      </button>
      {open && (
        <div className="exclusions-body">
          <div className="adv-section">
            <span className="adv-section-title">{t.excludedFolders}</span>
            <div className="exclusions-chips">
              {excluded.map((name) => (
                <span key={name} className="chip">
                  {name}
                  <button className="chip-remove" onClick={() => onChangeExcluded(excluded.filter((e) => e !== name))} disabled={disabled}>×</button>
                </span>
              ))}
            </div>
            <div className="exclusions-add">
              <input className="exclusions-input" value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFolder()}
                placeholder={t.addFolderPlaceholder} disabled={disabled} />
              <button className="btn-ghost" onClick={addFolder} disabled={disabled || !folderInput.trim()}>{t.add}</button>
            </div>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.excludeExtensions}</span>
            <div className="exclusions-chips">
              {excludeExtensions.map((ext) => (
                <span key={ext} className="chip">
                  .{ext}
                  <button className="chip-remove" onClick={() => onChangeExclude(excludeExtensions.filter((e) => e !== ext))} disabled={disabled}>×</button>
                </span>
              ))}
            </div>
            <div className="exclusions-add">
              <input className="exclusions-input" value={excludeInput}
                onChange={(e) => setExcludeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addExt(excludeExtensions, excludeInput, onChangeExclude, setExcludeInput)}
                placeholder={t.addExtPlaceholder} disabled={disabled} />
              <button className="btn-ghost" onClick={() => addExt(excludeExtensions, excludeInput, onChangeExclude, setExcludeInput)}
                disabled={disabled || !excludeInput.trim()}>{t.add}</button>
            </div>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.includeExtensions}</span>
            <div className="exclusions-chips">
              {includeExtensions.map((ext) => (
                <span key={ext} className="chip">
                  .{ext}
                  <button className="chip-remove" onClick={() => onChangeInclude(includeExtensions.filter((e) => e !== ext))} disabled={disabled}>×</button>
                </span>
              ))}
            </div>
            <div className="exclusions-add">
              <input className="exclusions-input" value={includeInput}
                onChange={(e) => setIncludeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addExt(includeExtensions, includeInput, onChangeInclude, setIncludeInput)}
                placeholder={t.addExtPlaceholder} disabled={disabled} />
              <button className="btn-ghost" onClick={() => addExt(includeExtensions, includeInput, onChangeInclude, setIncludeInput)}
                disabled={disabled || !includeInput.trim()}>{t.add}</button>
            </div>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.fileSizeFilter}</span>
            <label className="adv-row">
              <span>{t.minFileSizeKb}</span>
              <input type="number" min={0} className="adv-input" value={minFileSizeKb}
                onChange={(e) => onChangeMin(Math.max(0, Number(e.target.value)))}
                disabled={disabled} />
            </label>
            <label className="adv-row">
              <span>{t.maxFileSizeKb}</span>
              <input type="number" min={0} className="adv-input" value={maxFileSizeKb}
                onChange={(e) => onChangeMax(Math.max(0, Number(e.target.value)))}
                disabled={disabled} />
            </label>
            <span className="adv-hint" style={{ gridColumn: "1 / -1" }}>{t.noSizeLimit}</span>
          </div>
          <div className="adv-section">
            <label className="adv-row" title={t.tipExactCache}>
              <span>{t.exactCacheLabel}</span>
              <input type="checkbox" checked={exactCacheEnabled}
                onChange={(e) => onChangeCache(e.target.checked)} disabled={disabled} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
