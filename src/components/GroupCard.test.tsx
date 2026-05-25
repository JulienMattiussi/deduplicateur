import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { GroupCard } from "./GroupCard";
import { LangProvider } from "../LangContext";


beforeEach(() => {
  vi.clearAllMocks();
});

const baseGroup = {
  id: "g1",
  hash: "abc",
  size: 1024,
  files: [
    { path: "/a/file1.txt", size: 1024, name: "file1.txt", modified: 1700000000 },
    { path: "/b/file2.txt", size: 1024, name: "file2.txt", modified: 1700001000 },
  ],
};

const sortGroup = {
  id: "g-sort",
  hash: "abc",
  size: 1024,
  files: [
    { path: "/a/charlie.txt", size: 1024, name: "charlie.txt", modified: 1700002000 },
    { path: "/b/alpha.txt",   size: 2048, name: "alpha.txt",   modified: 1700001000 },
    { path: "/c/bravo.txt",   size: 512,  name: "bravo.txt",   modified: 1700000000 },
  ],
};

// ---- B : selection toggle d'un fichier ----
describe("B - toggle de selection d'un fichier", () => {
  it("appelle onToggle avec le bon path quand on clique sur la checkbox", () => {
    const onToggle = vi.fn();
    render(<GroupCard group={baseGroup} selected={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("/a/file1.txt");
  });

  it("appelle onToggle avec le second path quand on clique sur la deuxieme checkbox", () => {
    const onToggle = vi.fn();
    render(<GroupCard group={baseGroup} selected={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(onToggle).toHaveBeenCalledWith("/b/file2.txt");
  });
});

// ---- K : tri des colonnes dans GroupCard ----
describe("K - tri des colonnes GroupCard", () => {
  it("clic sur Nom trie par nom croissant (alpha en premier)", () => {
    const onToggle = vi.fn();
    render(<GroupCard group={sortGroup} selected={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("sort-name"));
    fireEvent.click(within(screen.getByTestId("group-files")).getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("/b/alpha.txt");
  });

  it("deuxieme clic sur Nom trie par nom decroissant (charlie en premier)", () => {
    const onToggle = vi.fn();
    render(<GroupCard group={sortGroup} selected={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("sort-name"));
    fireEvent.click(screen.getByTestId("sort-name"));
    fireEvent.click(within(screen.getByTestId("group-files")).getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("/a/charlie.txt");
  });

  it("troisieme clic sur Nom remet l'ordre original (charlie en premier)", () => {
    const onToggle = vi.fn();
    render(<GroupCard group={sortGroup} selected={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("sort-name"));
    fireEvent.click(screen.getByTestId("sort-name"));
    fireEvent.click(screen.getByTestId("sort-name"));
    fireEvent.click(within(screen.getByTestId("group-files")).getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("/a/charlie.txt");
  });

  it("indicateur visible apres premier clic sur Nom", () => {
    render(<GroupCard group={sortGroup} selected={new Set()} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByTestId("sort-name"));
    expect(screen.getByText("↑")).toBeInTheDocument();
  });

  it("indicateur visible apres deuxieme clic sur Nom", () => {
    render(<GroupCard group={sortGroup} selected={new Set()} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByTestId("sort-name"));
    fireEvent.click(screen.getByTestId("sort-name"));
    expect(screen.getByText("↓")).toBeInTheDocument();
  });

  it("indicateur absent apres troisieme clic (tri annule)", () => {
    render(<GroupCard group={sortGroup} selected={new Set()} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByTestId("sort-name"));
    fireEvent.click(screen.getByTestId("sort-name"));
    fireEvent.click(screen.getByTestId("sort-name"));
    expect(screen.queryByText("↑")).not.toBeInTheDocument();
    expect(screen.queryByText("↓")).not.toBeInTheDocument();
  });

  it("clic sur Modifie trie par date croissante (bravo, le plus ancien, en premier)", () => {
    const onToggle = vi.fn();
    render(<GroupCard group={sortGroup} selected={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("sort-modified"));
    fireEvent.click(within(screen.getByTestId("group-files")).getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("/c/bravo.txt");
  });
});

// ---- Badge "Original" reste sur le fichier le plus ancien malgre le tri local ----
describe("Badge original - independant du tri local", () => {
  function rowOf(name: string) {
    return screen.getByText(name).closest(".file-row") as HTMLElement;
  }

  it("le badge 'Original' est sur le fichier au mtime le plus bas, peu importe l'ordre des files dans le tableau", () => {
    // Dans sortGroup, bravo.txt est le plus ancien (mtime 1700000000) mais il est en
    // 3e position dans group.files. Le badge doit etre sur bravo.txt, pas sur charlie.txt.
    render(<GroupCard group={sortGroup} selected={new Set()} onToggle={() => {}} />);
    expect(within(rowOf("bravo.txt")).getByText(/Original/i)).toBeInTheDocument();
    expect(within(rowOf("charlie.txt")).queryByText(/Original/i)).not.toBeInTheDocument();
    expect(within(rowOf("alpha.txt")).queryByText(/Original/i)).not.toBeInTheDocument();
  });

  it("le badge 'Original' reste sur bravo.txt apres tri par Nom (alpha en premier visuellement)", () => {
    render(<GroupCard group={sortGroup} selected={new Set()} onToggle={() => {}} />);
    fireEvent.click(screen.getByTestId("sort-name")); // tri par nom asc -> alpha, bravo, charlie
    expect(within(rowOf("bravo.txt")).getByText(/Original/i)).toBeInTheDocument();
    expect(within(rowOf("alpha.txt")).queryByText(/Original/i)).not.toBeInTheDocument();
  });

  it("le badge 'Original' reste sur bravo.txt apres tri par Modifie descendant (charlie en premier visuellement)", () => {
    render(<GroupCard group={sortGroup} selected={new Set()} onToggle={() => {}} />);
    fireEvent.click(screen.getByTestId("sort-modified"));
    fireEvent.click(screen.getByTestId("sort-modified")); // desc -> charlie (recent), alpha, bravo
    expect(within(rowOf("bravo.txt")).getByText(/Original/i)).toBeInTheDocument();
    expect(within(rowOf("charlie.txt")).queryByText(/Original/i)).not.toBeInTheDocument();
  });
});

// ---- Q2 : badge "Ref." dans GroupCard ----
describe("Q2 - badge source dans GroupCard", () => {
  it("badge 'Ref.' visible sur le fichier secondaire", () => {
    const groupWithSource = {
      ...baseGroup,
      files: [
        { path: "/src/file1.txt", size: 1024, name: "file1.txt", modified: 1700000000, source: "primary" as const },
        { path: "/ref/file2.txt", size: 1024, name: "file2.txt", modified: 1700001000, source: "secondary" as const },
      ],
    };
    render(<GroupCard group={groupWithSource} selected={new Set()} onToggle={() => {}} />);
    expect(screen.getByTestId("badge-reference")).toBeInTheDocument();
  });

  it("badge 'Ref.' absent quand aucun fichier n'a source='secondary'", () => {
    render(<GroupCard group={baseGroup} selected={new Set()} onToggle={() => {}} />);
    expect(screen.queryByTestId("badge-reference")).not.toBeInTheDocument();
  });

  it("badge 'original' absent quand les fichiers ont un champ source", () => {
    const groupWithSource = {
      ...baseGroup,
      files: [
        { path: "/src/file1.txt", size: 1024, name: "file1.txt", modified: 1700000000, source: "primary" as const },
        { path: "/ref/file2.txt", size: 1024, name: "file2.txt", modified: 1700001000, source: "secondary" as const },
      ],
    };
    render(<GroupCard group={groupWithSource} selected={new Set()} onToggle={() => {}} />);
    expect(screen.queryByText("original")).not.toBeInTheDocument();
  });
});

// ---- J test 6 : GroupCard affiche l'icone et la duree pour un groupe audio_similar ----
describe("J - mode audio (GroupCard)", () => {
  it("GroupCard affiche l'icone et la duree pour un groupe audio_similar", () => {
    const audioGroup = {
      id: "ga1",
      hash: "audio",
      size: 5000000,
      audio_similar: true,
      files: [
        {
          path: "/music/track1.mp3",
          size: 5000000,
          name: "track1.mp3",
          modified: 1700000000,
          audio_metadata: { duration_secs: 183 },
        },
        {
          path: "/music/track2.mp3",
          size: 5000000,
          name: "track2.mp3",
          modified: 1700001000,
          audio_metadata: { duration_secs: 183 },
        },
      ],
    };

    const onToggle = vi.fn();
    render(
      <LangProvider>
        <GroupCard group={audioGroup} selected={new Set()} onToggle={onToggle} />
      </LangProvider>
    );

    expect(screen.getAllByText(/🎵/).length).toBeGreaterThan(0);
    // formatDurationSecs(183) = "3:03"
    const durations = screen.getAllByText("3:03");
    expect(durations.length).toBeGreaterThan(0);
  });
});

// ---- S : indicateur même dossier ----
describe("S - indicateur même dossier", () => {
  it("affiche le point de signalement quand deux fichiers sont dans le même dossier", () => {
    const sameDirGroup = {
      id: "g-samedir",
      hash: "abc",
      size: 1024,
      files: [
        { path: "/a/file1.txt", size: 1024, name: "file1.txt", modified: 1700000000 },
        { path: "/a/file2.txt", size: 1024, name: "file2.txt", modified: 1700001000 },
      ],
    };
    render(
      <LangProvider>
        <GroupCard group={sameDirGroup} selected={new Set()} onToggle={() => {}} />
      </LangProvider>
    );
    expect(document.querySelectorAll(".shared-dir-dot").length).toBe(2);
  });

  it("n'affiche pas le point quand les fichiers sont dans des dossiers différents", () => {
    render(
      <LangProvider>
        <GroupCard group={baseGroup} selected={new Set()} onToggle={() => {}} />
      </LangProvider>
    );
    expect(document.querySelector(".shared-dir-dot")).not.toBeInTheDocument();
  });

  it("n'affiche le point que sur les lignes du dossier partagé (groupe mixte)", () => {
    const mixedGroup = {
      id: "g-mixed",
      hash: "abc",
      size: 1024,
      files: [
        { path: "/a/file1.txt", size: 1024, name: "file1.txt", modified: 1700000000 },
        { path: "/a/file2.txt", size: 1024, name: "file2.txt", modified: 1700001000 },
        { path: "/b/file3.txt", size: 1024, name: "file3.txt", modified: 1700002000 },
      ],
    };
    render(
      <LangProvider>
        <GroupCard group={mixedGroup} selected={new Set()} onToggle={() => {}} />
      </LangProvider>
    );
    expect(document.querySelectorAll(".shared-dir-dot").length).toBe(2);
  });
});
