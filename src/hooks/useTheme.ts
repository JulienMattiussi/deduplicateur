import { useState, useEffect } from "react";

export type Theme = "dark" | "light";

/**
 * Theme dark/light avec persistance localStorage. Le state initial lit la
 * preference sauvegardee (defaut "dark"). Chaque changement est synchronise
 * sur le storage. Le composant racine applique `data-theme` sur l'element
 * racine pour declencher les variables CSS.
 */
export function useTheme(): {
  theme: Theme;
  toggleTheme: () => void;
} {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem("theme") as Theme) ?? "dark"
  );

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  return {
    theme,
    toggleTheme: () => setTheme((v) => (v === "dark" ? "light" : "dark")),
  };
}
