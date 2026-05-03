import { useState, useEffect, useRef, useMemo } from "react";
import { useLang } from "../LangContext";
import { HELP_SECTIONS, HELP_ARTICLES } from "../help/content";

interface Props {
  onClose: () => void;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const m = match[0];
    if (m.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-${idx++}`}>{m.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={`${keyPrefix}-${idx++}`}>{m.slice(1, -1)}</code>);
    }
    last = match.index + m.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderBody(body: string): React.ReactNode {
  return body.split("\n\n").map((block, i) => {
    const lines = block.split("\n");
    if (lines.length > 0 && lines.every((l) => l.startsWith("- "))) {
      return (
        <ul key={i} className="help-body-list">
          {lines.map((l, j) => (
            <li key={j}>{renderInline(l.slice(2), `${i}-${j}`)}</li>
          ))}
        </ul>
      );
    }
    return <p key={i} className="help-body-p">{renderInline(block, String(i))}</p>;
  });
}

export function HelpPanel({ onClose }: Props) {
  const { t, lang } = useLang();
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string>(HELP_ARTICLES[0]?.id ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = search.toLowerCase().trim();

  const filtered = useMemo(() => {
    if (!q) return HELP_ARTICLES;
    return HELP_ARTICLES.filter((a) => {
      const title = a.title[lang].toLowerCase();
      const keywords = a.keywords[lang].join(" ").toLowerCase();
      const body = a.body[lang].toLowerCase();
      return title.includes(q) || keywords.includes(q) || body.includes(q);
    });
  }, [q, lang]);

  const activeArticle = useMemo(
    () => HELP_ARTICLES.find((a) => a.id === activeId) ?? null,
    [activeId]
  );

  useEffect(() => {
    if (filtered.length > 0 && !filtered.find((a) => a.id === activeId)) {
      setActiveId(filtered[0].id);
    }
  }, [filtered]);

  const isSearching = q.length > 0;

  return (
    <>
      <div className="help-overlay" onClick={onClose} aria-hidden="true" />
      <div
        className="help-drawer"
        role="dialog"
        aria-label={t.helpTitle}
        data-testid="help-panel"
      >
        <div className="help-header">
          <h2 className="help-title">{t.helpTitle}</h2>
          <input
            ref={inputRef}
            className="help-search"
            type="search"
            placeholder={t.helpSearch}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="help-search"
          />
          <button className="help-close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="help-body">
          <nav className="help-nav" aria-label="Articles">
            {isSearching ? (
              <ul className="help-nav-flat">
                {filtered.length === 0 ? (
                  <li className="help-no-results">{t.helpNoResults}</li>
                ) : (
                  filtered.map((a) => (
                    <li key={a.id}>
                      <button
                        className={`help-nav-item${a.id === activeId ? " help-nav-item--active" : ""}`}
                        onClick={() => setActiveId(a.id)}
                      >
                        {a.title[lang]}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : (
              <div className="help-nav-sections">
                {HELP_SECTIONS.map((section) => {
                  const articles = HELP_ARTICLES.filter(
                    (a) => a.sectionId === section.id
                  );
                  if (articles.length === 0) return null;
                  return (
                    <div key={section.id} className="help-nav-section">
                      <div className="help-nav-section-title">
                        {section.title[lang]}
                      </div>
                      <ul>
                        {articles.map((a) => (
                          <li key={a.id}>
                            <button
                              className={`help-nav-item${a.id === activeId ? " help-nav-item--active" : ""}`}
                              onClick={() => setActiveId(a.id)}
                            >
                              {a.title[lang]}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </nav>

          <article className="help-article">
            {activeArticle ? (
              <>
                <h3 className="help-article-title">
                  {activeArticle.title[lang]}
                </h3>
                <div className="help-article-body">
                  {renderBody(activeArticle.body[lang])}
                </div>
              </>
            ) : (
              <p className="help-no-results">{t.helpNoResults}</p>
            )}
          </article>
        </div>
      </div>
    </>
  );
}
