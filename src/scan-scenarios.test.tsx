/**
 * Scénarios complets : 3 modes × 4 types × 2 résultats = 24 scénarios
 * + régressions ciblées sur les bugs découverts manuellement.
 *
 * Chaque scénario vérifie :
 *  1. scan_folder appelé avec les bons paramètres (mode + type)
 *  2. État de l'UI cohérent (groupes affichés ou état vide)
 *  3. Comportements spécifiques au mode (list_folder_keys, secondaryFolder…)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { translations } from "./i18n";

// ---- Mocks ---------------------------------------------------------------

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockDialogOpen = dialogOpen as ReturnType<typeof vi.fn>;

const defaultPhashConfig = {
  min_file_size_bytes: 10240, min_images_size_filter: 50, aspect_ratio_tolerance: 0.2,
  min_images_aspect_filter: 10, two_pass_enabled: true, coarse_hash_size: 4, fine_hash_size: 8,
  coarse_threshold_multiplier: 2.0, min_images_two_pass: 20, cache_enabled: true,
  parallel_compare_enabled: true, min_images_parallel_compare: 200, perf_log_enabled: false,
};
const defaultVideoConfig = { n_frames: 8, duration_tolerance: 0.2, cache_enabled: true, use_dtw: false };
const defaultAudioConfig = { duration_tolerance: 0.2, cache_enabled: true };

function makeDefaultMock(overrides: Record<string, unknown> = {}) {
  return (cmd: string, ...args: unknown[]) => {
    if (cmd in overrides) {
      const val = overrides[cmd];
      if (typeof val === "function") return (val as (...a: unknown[]) => unknown)(cmd, ...args);
      return Promise.resolve(val);
    }
    if (cmd === "list_sessions") return Promise.resolve([]);
    if (cmd === "get_cache_size") return Promise.resolve(0);
    if (cmd === "check_tools") return Promise.resolve({ ffmpeg_available: true, fpcalc_available: true });
    if (cmd === "get_phash_config") return Promise.resolve(defaultPhashConfig);
    if (cmd === "get_video_config") return Promise.resolve(defaultVideoConfig);
    if (cmd === "get_audio_config") return Promise.resolve(defaultAudioConfig);
    if (cmd === "list_profiles") return Promise.resolve([]);
    if (cmd === "get_ignore_list") return Promise.resolve([]);
    return Promise.resolve(null);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockInvoke.mockImplementation(makeDefaultMock());
});

// ---- Fixtures ------------------------------------------------------------

const fileGroup = {
  id: "gf1", hash: "f1", size: 1024,
  files: [
    { path: "/a/doc.txt", size: 1024, name: "doc.txt", modified: 1700000000 },
    { path: "/b/doc_copy.txt", size: 1024, name: "doc_copy.txt", modified: 1700001000 },
  ],
};

const imageGroup = {
  id: "gi1", hash: "i1", size: 2048, similar: true,
  files: [
    { path: "/a/photo.jpg", size: 2048, name: "photo.jpg", modified: 1700000000 },
    { path: "/b/photo_copy.jpg", size: 2048, name: "photo_copy.jpg", modified: 1700001000 },
  ],
};

const videoGroup = {
  id: "gv1", hash: "v1", size: 50_000_000, video_similar: true,
  files: [
    { path: "/a/movie.mp4", size: 50_000_000, name: "movie.mp4", modified: 1700000000,
      video_metadata: { duration_secs: 120, width: 1920, height: 1080, codec: "h264" } },
    { path: "/b/movie_copy.mp4", size: 50_000_000, name: "movie_copy.mp4", modified: 1700001000,
      video_metadata: { duration_secs: 120, width: 1920, height: 1080, codec: "h264" } },
  ],
};

const audioGroup = {
  id: "ga1", hash: "a1", size: 5_000_000, audio_similar: true,
  files: [
    { path: "/a/track.mp3", size: 5_000_000, name: "track.mp3", modified: 1700000000,
      audio_metadata: { duration_secs: 180 } },
    { path: "/b/track_copy.mp3", size: 5_000_000, name: "track_copy.mp3", modified: 1700001000,
      audio_metadata: { duration_secs: 180 } },
  ],
};

type ScanMode = "all" | "by_folder" | "compare_folder";
type DataType = "files" | "images" | "videos" | "audio";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const groupByType: Record<DataType, any> = {
  files: fileGroup, images: imageGroup, videos: videoGroup, audio: audioGroup,
};

// Regex attendus pour le texte de groupe dans GroupCard
const groupTextByType: Record<DataType, RegExp> = {
  files: /2 fichiers identiques/,
  images: /2 images similaires/,
  videos: /2 vidéos similaires/,
  audio: /2 fichiers audio similaires/,
};

// ---- Builders ------------------------------------------------------------

function makeSummary(mode: ScanMode, type: DataType, hasResults: boolean) {
  const group = groupByType[type];
  return {
    id: "s1",
    folder: "/home/test",
    total_wasted_bytes: hasResults ? group.size : 0,
    total_groups: hasResults ? 1 : 0,
    scanned_files: 20,
    duration_ms: 100,
    by_folder: mode === "by_folder",
    total_folders: mode === "by_folder" ? 1 : 0,
    partial: false,
    find_similar: type === "images" ? true : undefined,
    find_similar_videos: type === "videos" ? true : undefined,
    find_similar_audio: type === "audio" ? true : undefined,
  };
}

function makeMock(mode: ScanMode, type: DataType, hasResults: boolean) {
  const summary = makeSummary(mode, type, hasResults);
  const rawGroup = groupByType[type];
  const group = mode === "by_folder" ? { ...rawGroup, folder_key: "SubFolder" } : rawGroup;
  const groups = hasResults ? [group] : [];
  const folderSummaries = hasResults && mode === "by_folder"
    ? [{ folder_key: "SubFolder", group_count: 1, total_wasted_bytes: rawGroup.size }]
    : [];

  return makeDefaultMock({
    scan_folder: summary,
    // get_groups_page n'est appelé que si by_folder = false
    get_groups_page: { groups: mode !== "by_folder" ? groups : [], offset: 0, total: groups.length, has_more: false },
    list_folder_keys: folderSummaries,
    get_folder_groups_page: { groups, has_more: false },
  });
}

/** Paramètres attendus dans l'appel scan_folder selon le mode et le type. */
function expectedScanParams(mode: ScanMode, type: DataType) {
  return {
    byFolder: mode === "by_folder",
    findSimilar: type === "images",
    findSimilarVideos: type === "videos",
    findSimilarAudio: type === "audio",
    secondaryFolder: mode === "compare_folder" ? "/home/ref" : null,
  };
}

// ---- Lanceur de scénario -------------------------------------------------

async function runScenario(mode: ScanMode, type: DataType, hasResults: boolean) {
  const user = userEvent.setup();
  mockInvoke.mockImplementation(makeMock(mode, type, hasResults));

  if (mode === "compare_folder") {
    mockDialogOpen.mockResolvedValueOnce("/home/test").mockResolvedValueOnce("/home/ref");
  } else {
    mockDialogOpen.mockResolvedValue("/home/test");
  }

  render(<App />);

  // Choisir le dossier principal
  await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
  await waitFor(() => screen.getByText("/home/test"));

  // Sélectionner le mode de scan (seulement si != all)
  if (mode !== "all") {
    await user.selectOptions(screen.getAllByRole("combobox")[0], mode);
  }

  // Dossier secondaire (compare_folder seulement)
  if (mode === "compare_folder") {
    await user.click(screen.getByTestId("secondary-folder-input"));
    await waitFor(() => screen.getByText("/home/ref"));
  }

  // Sélectionner le type de détection
  if (type === "images") await user.click(screen.getByText("🖼 Images"));
  else if (type === "videos") await user.click(screen.getByText("🎬 Vidéos"));
  else if (type === "audio") await user.click(screen.getByText("🎵 Audio"));

  // Lancer le scan
  await user.click(screen.getByText("Analyser"));

  // Attendre la fin du scan (la stats-row apparaît dès que summary est défini)
  await waitFor(() => screen.getByTestId("stats-row"), { timeout: 5000 });

  return user;
}

// ---- 24 scénarios --------------------------------------------------------

type Scenario = { mode: ScanMode; type: DataType; hasResults: boolean };

const SCENARIOS: Scenario[] = (["all", "by_folder", "compare_folder"] as ScanMode[]).flatMap(
  (mode) => (["files", "images", "videos", "audio"] as DataType[]).flatMap(
    (type) => [true, false].map((hasResults) => ({ mode, type, hasResults }))
  )
);

describe("S - Scénarios complets (3 modes × 4 types × 2 résultats = 24)", () => {
  it.each(SCENARIOS)(
    "$mode / $type / $hasResults",
    async ({ mode, type, hasResults }) => {
      await runScenario(mode, type, hasResults);

      // 1. scan_folder appelé avec les bons paramètres
      expect(mockInvoke).toHaveBeenCalledWith(
        "scan_folder",
        expect.objectContaining(expectedScanParams(mode, type))
      );

      if (hasResults) {
        if (mode === "by_folder") {
          // list_folder_keys doit être appelé après le scan
          expect(mockInvoke).toHaveBeenCalledWith("list_folder_keys", { filterText: null });
          // L'en-tête de section du dossier doit être visible (replié par défaut)
          expect(screen.getByText(/SubFolder/)).toBeInTheDocument();
        } else {
          // Le texte du groupe doit être visible
          expect(screen.getByText(groupTextByType[type])).toBeInTheDocument();
        }
      } else {
        // État vide
        expect(screen.getByText(/Aucun doublon/)).toBeInTheDocument();
        if (mode === "by_folder") {
          // list_folder_keys est appelé même quand il n'y a pas de résultats
          expect(mockInvoke).toHaveBeenCalledWith("list_folder_keys", { filterText: null });
        }
      }
    }
  );
});

// ---- Régressions ---------------------------------------------------------

describe("T - Régressions", () => {
  /**
   * Bug 1 : en mode by_folder, handleDeleteComplete utilisait updatedGroups.length
   * comme valeur absolue de total_groups. Si seul 1 dossier sur 50 était déplié,
   * supprimer son unique groupe faisait passer total_groups à 0 au lieu de 49.
   */
  it("Bug 1 - by_folder : supprimer un groupe d'un dossier partiellement chargé décrémente total_groups sans le mettre à 0", async () => {
    const user = userEvent.setup();

    // 50 groupes au total, répartis sur 2 dossiers : Photos (1) et Backup (49)
    const imageGroupWithFolder = { ...imageGroup, folder_key: "Photos" };
    const summary = {
      id: "s-bug1", folder: "/home/test",
      total_wasted_bytes: 50 * imageGroup.size,
      total_groups: 50, scanned_files: 100,
      duration_ms: 200, by_folder: true, total_folders: 2, partial: false,
    };
    const folderSummaries = [
      { folder_key: "Photos", group_count: 1, total_wasted_bytes: imageGroup.size },
      { folder_key: "Backup", group_count: 49, total_wasted_bytes: 49 * imageGroup.size },
    ];

    mockInvoke.mockImplementation(makeDefaultMock({
      scan_folder: summary,
      list_folder_keys: folderSummaries,
      get_folder_groups_page: { groups: [imageGroupWithFolder], has_more: false },
      delete_files: [],
    }));
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.selectOptions(screen.getAllByRole("combobox")[0], "by_folder");
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => screen.getByTestId("stats-row"), { timeout: 5000 });

    // Déplier le dossier "Photos" pour charger ses groupes
    await user.click(screen.getByText(/Photos/));
    await waitFor(() => screen.getByText("photo.jpg"));

    // Cocher le premier fichier du groupe et supprimer
    await user.click(within(screen.getByTestId("group-files")).getAllByRole("checkbox")[0]);
    const deleteBtn = await screen.findByText(/Supprimer 1 fichier/);
    await user.click(deleteBtn);
    await user.click(await screen.findByRole("button", { name: "Supprimer" }));

    // Après suppression : total_groups doit être 49 (pas 0)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("delete_files", expect.anything());
    });
    // L'écran "aucun doublon" ne doit PAS apparaître : il reste 49 groupes dans Backup
    await waitFor(() => {
      expect(screen.queryByText(/Aucun doublon/)).not.toBeInTheDocument();
    });
    // La section "Backup" doit toujours être visible
    expect(screen.getByText(/Backup/)).toBeInTheDocument();
    // total_folders doit avoir decremente : "Photos" perd son dernier groupe -> 1 dossier restant
    await waitFor(() => {
      const statsRow = screen.getByTestId("stats-row");
      expect(within(statsRow).getByText(/^1$/)).toBeInTheDocument();
      expect(within(statsRow).getByText(/^dossier$/)).toBeInTheDocument();
    });
  });

  /**
   * Bug 4 : en mode by_folder, ignorer le seul groupe d'un dossier le retirait
   * de la liste mais summary.total_folders n'etait pas decremente. Le compteur
   * "X dossiers" affiche en haut restait fige sur la valeur d'origine.
   */
  it("Bug 4 - by_folder : ignorer le seul groupe d'un dossier decremente total_folders", async () => {
    const user = userEvent.setup();
    const imageGroupWithFolder = { ...imageGroup, folder_key: "Photos" };
    const summary = {
      id: "s-bug4", folder: "/home/test",
      total_wasted_bytes: 50 * imageGroup.size,
      total_groups: 50, scanned_files: 100,
      duration_ms: 200, by_folder: true, total_folders: 2, partial: false,
    };
    const folderSummaries = [
      { folder_key: "Photos", group_count: 1, total_wasted_bytes: imageGroup.size },
      { folder_key: "Backup", group_count: 49, total_wasted_bytes: 49 * imageGroup.size },
    ];

    mockInvoke.mockImplementation(makeDefaultMock({
      scan_folder: summary,
      list_folder_keys: folderSummaries,
      get_folder_groups_page: { groups: [imageGroupWithFolder], has_more: false },
      ignore_group: null,
    }));
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.selectOptions(screen.getAllByRole("combobox")[0], "by_folder");
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => screen.getByTestId("stats-row"), { timeout: 5000 });

    // Avant : 2 dossiers
    expect(within(screen.getByTestId("stats-row")).getByText(/^2$/)).toBeInTheDocument();

    // Deplier "Photos" et ignorer son unique groupe (clic sur la croix puis confirmation)
    await user.click(screen.getByText(/Photos/));
    await waitFor(() => screen.getByText("photo.jpg"));
    await user.click(screen.getByTestId("ignore-group-btn"));
    await user.click(await screen.findByTestId("ignore-confirm-btn"));

    // Apres : 1 dossier
    await waitFor(() => {
      const statsRow = screen.getByTestId("stats-row");
      expect(within(statsRow).getByText(/^1$/)).toBeInTheDocument();
      expect(within(statsRow).getByText(/^dossier$/)).toBeInTheDocument();
    });
  });

  /**
   * Bug 5 : en mode by_folder, un dossier avec plus de groupes que la page (50)
   * voyait sa pagination cassee apres suppression. L'offset de loadFolderPage
   * etait un compteur cumulatif (state.offset) qui ne suivait pas la purge du
   * cache backend -> get_folder_groups_page etait rappele avec un offset trop
   * grand -> page vide -> dossier qui disparait. Le fix passe un offsetOverride
   * = nombre de groupes du dossier encore affiches.
   */
  it("Bug 5 - by_folder : suppression de la page chargee recharge la suite avec offset corrige", async () => {
    const user = userEvent.setup();
    // Dossier "Big" avec 3 groupes au total mais on en charge 2 a la fois.
    const mk = (id: string) => ({
      id, hash: id, size: 2048, similar: true, folder_key: "Big",
      files: [
        { path: `/Big/${id}_a.jpg`, size: 2048, name: `${id}_a.jpg`, modified: 1700000000 },
        { path: `/Big/${id}_b.jpg`, size: 2048, name: `${id}_b.jpg`, modified: 1700001000 },
      ],
    });
    const g1 = mk("g1"), g2 = mk("g2"), g3 = mk("g3");
    const summary = {
      id: "s-bug5", folder: "/home/test",
      total_wasted_bytes: 3 * 2048, total_groups: 3, scanned_files: 6,
      duration_ms: 100, by_folder: true, total_folders: 1, partial: false, find_similar: true,
    };

    let folderPageCalls = 0;
    const folderPageOffsets: number[] = [];
    mockInvoke.mockImplementation(makeDefaultMock({
      scan_folder: summary,
      list_folder_keys: [{ folder_key: "Big", group_count: 3, total_wasted_bytes: 3 * 2048 }],
      get_folder_groups_page: (_cmd: string, args: any) => {
        folderPageCalls++;
        folderPageOffsets.push(args.offset);
        // 1er appel (offset 0) : on renvoie 2 groupes, has_more=true (1 en attente).
        // 2e appel (apres suppr, offset corrige 0) : on renvoie le 3eme, has_more=false.
        if (folderPageCalls === 1) return Promise.resolve({ groups: [g1, g2], has_more: true });
        return Promise.resolve({ groups: [g3], has_more: false });
      },
      // "Tout cocher" coche le doublon (2e fichier) de chaque groupe charge.
      select_all_duplicates: ["/Big/g1_b.jpg", "/Big/g2_b.jpg"],
      delete_files: [],
    }));
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.selectOptions(screen.getAllByRole("combobox")[0], "by_folder");
    await user.click(screen.getByText("🖼 Images"));
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => screen.getByTestId("stats-row"), { timeout: 5000 });

    await user.click(screen.getByText(/Big/));
    await waitFor(() => screen.getByText("g1_a.jpg"));

    // Cocher tout (les 2 groupes charges) puis supprimer.
    await user.click(screen.getByRole("button", { name: "Tout cocher" }));
    const deleteBtn = await screen.findByText(/Supprimer \d+ fichier/);
    await user.click(deleteBtn);
    await user.click(await screen.findByRole("button", { name: "Supprimer" }));

    // Apres suppression : le 3eme groupe doit etre charge (pagination relancee).
    await waitFor(() => {
      expect(screen.getByText("g3_a.jpg")).toBeInTheDocument();
    });
    // Le 2e appel a get_folder_groups_page doit utiliser offset=0 (pas 2),
    // car les 2 groupes charges ont ete supprimes du cache backend.
    expect(folderPageOffsets[folderPageOffsets.length - 1]).toBe(0);
  });

  /**
   * Filtre texte en mode by_folder : le filtre "regarde tout" (folder_key + noms +
   * chemins de fichiers). Comme les fichiers ne sont pas charges cote frontend en
   * mode dossier, le filtre descend au backend : list_folder_keys et
   * get_folder_groups_page sont rappeles avec filterText (debounce ~250ms).
   */
  it("by_folder : taper un filtre rappelle list_folder_keys + get_folder_groups_page avec filterText", async () => {
    const user = userEvent.setup();
    const imageGroupWithFolder = { ...imageGroup, folder_key: "Photos" };
    const summary = {
      id: "s-filter-byfolder", folder: "/home/test",
      total_wasted_bytes: imageGroup.size,
      total_groups: 1, scanned_files: 10,
      duration_ms: 100, by_folder: true, total_folders: 1, partial: false,
      find_similar: true,
    };
    const folderSummaries = [
      { folder_key: "Photos", group_count: 1, total_wasted_bytes: imageGroup.size },
    ];

    const listFolderKeysFilters: (string | null)[] = [];
    const folderPageFilters: (string | null)[] = [];
    mockInvoke.mockImplementation(makeDefaultMock({
      scan_folder: summary,
      list_folder_keys: (_cmd: string, args: any) => {
        listFolderKeysFilters.push(args?.filterText ?? null);
        return Promise.resolve(folderSummaries);
      },
      get_folder_groups_page: (_cmd: string, args: any) => {
        folderPageFilters.push(args?.filterText ?? null);
        return Promise.resolve({ groups: [imageGroupWithFolder], has_more: false });
      },
    }));
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.selectOptions(screen.getAllByRole("combobox")[0], "by_folder");
    await user.click(screen.getByText("🖼 Images"));
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => screen.getByTestId("stats-row"), { timeout: 5000 });

    // Le chargement initial passe filterText=null (pas de filtre).
    expect(listFolderKeysFilters).toContain(null);

    // Taper un filtre qui matche un nom de fichier (pas le folder_key).
    const input = screen.getByPlaceholderText(/Filtrer par nom/i);
    await user.type(input, "photo");

    // Apres le debounce, list_folder_keys est rappele avec le filtre.
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("list_folder_keys", { filterText: "photo" });
    }, { timeout: 2000 });

    // Deplier le dossier : get_folder_groups_page doit recevoir le meme filtre.
    await user.click(screen.getByText(/Photos/));
    await waitFor(() => {
      expect(folderPageFilters).toContain("photo");
    });
  });

  /**
   * Bug 2 : en mode by_folder, FolderSection ne transmettait pas onCompare/onCompareVideo
   * à GroupCard. Le bouton "Comparer" n'était donc jamais rendu pour les groupes images.
   */
  it("Bug 2 - by_folder images : le bouton Comparer est visible après dépliage d'un dossier", async () => {
    const user = userEvent.setup();

    const imageGroupWithFolder = { ...imageGroup, folder_key: "Photos" };
    const summary = {
      id: "s-bug2", folder: "/home/test",
      total_wasted_bytes: imageGroup.size,
      total_groups: 1, scanned_files: 10,
      duration_ms: 100, by_folder: true, total_folders: 1, partial: false,
      find_similar: true,
    };
    const folderSummaries = [
      { folder_key: "Photos", group_count: 1, total_wasted_bytes: imageGroup.size },
    ];

    mockInvoke.mockImplementation(makeDefaultMock({
      scan_folder: summary,
      list_folder_keys: folderSummaries,
      get_folder_groups_page: { groups: [imageGroupWithFolder], has_more: false },
    }));
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.selectOptions(screen.getAllByRole("combobox")[0], "by_folder");
    await user.click(screen.getByText("🖼 Images"));
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => screen.getByTestId("stats-row"), { timeout: 5000 });

    // Déplier le dossier "Photos"
    await user.click(screen.getByText(/Photos/));
    await waitFor(() => screen.getByText("photo.jpg"));

    // Le bouton "Comparer" doit être visible dans le GroupCard
    expect(screen.getByRole("button", { name: "Comparer" })).toBeInTheDocument();
  });

  /**
   * Bug 3 : le texte almostDone commençait par "- "
   * ce qui affichait un tiret solitaire sur sa ligne dans ProgressETA.
   * (Les anciennes cles `estimating` / `aboutTime` ont ete supprimees,
   * elles n'etaient utilisees nulle part.)
   */
  it("Bug 3 - almostDone ne commence pas par un tiret", () => {
    expect(translations.fr.almostDone).not.toMatch(/^-/);
    expect(translations.en.almostDone).not.toMatch(/^-/);
  });
});
