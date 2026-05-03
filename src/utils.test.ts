import { describe, it, expect } from "vitest";
import { formatSize, dirname, fileExt, formatDate, formatDurationSecs } from "./utils";

describe("formatSize", () => {
  it("affiche les octets", () => {
    expect(formatSize(0)).toBe("0 o");
    expect(formatSize(1)).toBe("1 o");
    expect(formatSize(1023)).toBe("1023 o");
  });

  it("affiche les Ko", () => {
    expect(formatSize(1024)).toBe("1.0 Ko");
    expect(formatSize(1536)).toBe("1.5 Ko");
    expect(formatSize(1024 * 1023)).toBe("1023.0 Ko");
  });

  it("affiche les Mo", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 Mo");
    expect(formatSize(1024 * 1024 * 11.4)).toContain("Mo");
  });

  it("affiche les Go", () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe("1.00 Go");
    expect(formatSize(1024 * 1024 * 1024 * 2.5)).toBe("2.50 Go");
  });
});

describe("dirname", () => {
  it("retourne le dossier parent (chemin Unix)", () => {
    expect(dirname("/home/user/photos/image.jpg")).toBe("/home/user/photos");
    expect(dirname("/home/user/fichier.txt")).toBe("/home/user");
  });

  it("retourne le dossier parent (chemin Windows)", () => {
    expect(dirname("C:\\Users\\user\\photos\\image.jpg")).toBe("C:\\Users\\user\\photos");
  });

  it("retourne le séparateur pour un fichier à la racine", () => {
    expect(dirname("/fichier.txt")).toBe("/");
  });

  it("gère un fichier sans dossier parent", () => {
    expect(dirname("fichier.txt")).toBe("");
  });
});

describe("fileExt", () => {
  it("retourne l'extension en minuscules", () => {
    expect(fileExt("/photos/img.JPG")).toBe("jpg");
    expect(fileExt("archive.TAR.GZ")).toBe("gz");
  });

  it("retourne une chaîne vide si pas d'extension", () => {
    expect(fileExt("fichier_sans_ext")).toBe("fichier_sans_ext");
  });
});

describe("formatDate", () => {
  it("retourne - pour un timestamp nul", () => {
    expect(formatDate(0, "fr-FR")).toBe("-");
  });

  it("formate un timestamp Unix valide", () => {
    // 2023-11-14 UTC
    const result = formatDate(1699920000, "fr-FR");
    expect(result).toContain("2023");
    expect(result).toContain("nov");
  });
});

describe("formatDurationSecs", () => {
  it("formate moins d'une heure", () => {
    expect(formatDurationSecs(0)).toBe("0:00");
    expect(formatDurationSecs(65)).toBe("1:05");
    expect(formatDurationSecs(3599)).toBe("59:59");
  });

  it("formate une heure ou plus", () => {
    expect(formatDurationSecs(3600)).toBe("1:00:00");
    expect(formatDurationSecs(3661)).toBe("1:01:01");
  });
});
