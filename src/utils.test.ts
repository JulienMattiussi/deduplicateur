import { describe, it, expect } from "vitest";
import { formatSize, dirname } from "./utils";

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
    expect(dirname("/home/julien/photos/image.jpg")).toBe("/home/julien/photos");
    expect(dirname("/home/julien/fichier.txt")).toBe("/home/julien");
  });

  it("retourne le dossier parent (chemin Windows)", () => {
    expect(dirname("C:\\Users\\julien\\photos\\image.jpg")).toBe("C:\\Users\\julien\\photos");
  });

  it("retourne le séparateur pour un fichier à la racine", () => {
    expect(dirname("/fichier.txt")).toBe("/");
  });

  it("gère un fichier sans dossier parent", () => {
    expect(dirname("fichier.txt")).toBe("");
  });
});
