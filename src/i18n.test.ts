import { describe, it, expect } from "vitest";
import { interp, pluralInterp, translations } from "./i18n";

describe("interp", () => {
  it("remplace une clé simple", () => {
    expect(interp("Bonjour {name}", { name: "Alice" })).toBe("Bonjour Alice");
  });

  it("remplace plusieurs clés", () => {
    expect(interp("{n} fichier{s}", { n: 2, s: "s" })).toBe("2 fichiers");
  });

  it("laisse intact une clé absente", () => {
    expect(interp("test {missing}", {})).toBe("test {missing}");
  });

  it("accepte des valeurs numériques", () => {
    expect(interp("il y a {n} h", { n: 3 })).toBe("il y a 3 h");
  });

  it("deleteN pluralise correctement en FR", () => {
    expect(pluralInterp(translations.fr.deleteN, 3, { size: "1,2 Mo" })).toBe("Supprimer 3 fichiers (1,2 Mo)");
    expect(pluralInterp(translations.fr.deleteN, 1, { size: "500 Ko" })).toBe("Supprimer 1 fichier (500 Ko)");
  });

  it("deleteN pluralise correctement en EN", () => {
    expect(pluralInterp(translations.en.deleteN, 3, { size: "1.2 MB" })).toBe("Delete 3 files (1.2 MB)");
    expect(pluralInterp(translations.en.deleteN, 1, { size: "500 KB" })).toBe("Delete 1 file (500 KB)");
  });
});

describe("translations", () => {
  it("fr et en ont exactement les mêmes clés", () => {
    expect(Object.keys(translations.fr).sort()).toEqual(Object.keys(translations.en).sort());
  });

  it("aucune valeur FR n'est vide", () => {
    for (const [key, val] of Object.entries(translations.fr)) {
      expect(val, `fr.${key} est vide`).not.toBe("");
    }
  });

  it("aucune valeur EN n'est vide", () => {
    for (const [key, val] of Object.entries(translations.en)) {
      expect(val, `en.${key} est vide`).not.toBe("");
    }
  });

  it("les clés à placeholders contiennent bien leurs variables", () => {
    expect(translations.fr.deleteN.other).toContain("{n}");
    expect(translations.fr.deleteN.other).toContain("{size}");
    expect(translations.fr.scanProgress).toContain("{n}");
    expect(translations.fr.scanProgress).toContain("{m}");
    expect(translations.fr.loadMore).toContain("{n}");
    expect(translations.fr.minutesAgo).toContain("{n}");
  });

  it("les clés de durée sont cohérentes entre FR et EN", () => {
    expect(translations.fr.durationMs).toBe(translations.en.durationMs);
    expect(translations.fr.durationS).toBe(translations.en.durationS);
    expect(translations.fr.durationMin).toBe(translations.en.durationMin);
    expect(translations.fr.durationH).toBe(translations.en.durationH);
  });
});
