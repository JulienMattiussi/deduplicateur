import { describe, it, expect } from "vitest";
import { interp, translations } from "./i18n";

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

  it("deleteN s'interpole correctement en FR", () => {
    const result = interp(translations.fr.deleteN, { n: 3, s: "s", size: "1,2 Mo" });
    expect(result).toContain("3");
    expect(result).toContain("1,2 Mo");
  });

  it("deleteN s'interpole correctement en EN", () => {
    const result = interp(translations.en.deleteN, { n: 1, s: "", size: "500 KB" });
    expect(result).toContain("1");
    expect(result).toContain("500 KB");
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
    expect(translations.fr.deleteN).toContain("{n}");
    expect(translations.fr.deleteN).toContain("{s}");
    expect(translations.fr.deleteN).toContain("{size}");
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
