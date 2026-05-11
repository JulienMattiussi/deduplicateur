import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { NativeComparatorBody } from "./NativeComparatorBody";
import { LangProvider } from "../LangContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = invoke as ReturnType<typeof vi.fn>;

// Etat de mock incremental : chaque NativeVideo qui invoque native_player_create se
// voit attribuer un id incremental (1 puis 2 = gauche puis droite).
let nextId = 1;
let stateOverride: Record<string, unknown> = {};

function defaultInvokeImpl(cmd: string, _args?: unknown) {
  if (cmd === "native_player_create") return Promise.resolve(nextId++);
  if (cmd === "native_player_get_state") {
    return Promise.resolve({
      current_time: 0,
      duration: 60,
      paused: true,
      eof: false,
      loaded: true,
      ...stateOverride,
    });
  }
  return Promise.resolve(undefined);
}

beforeEach(() => {
  mockInvoke.mockReset();
  nextId = 1;
  stateOverride = {};
  mockInvoke.mockImplementation(defaultInvokeImpl);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderBody() {
  return render(
    <LangProvider>
      <NativeComparatorBody
        leftPath="/videos/left.wmv"
        rightPath="/videos/right.avi"
        leftMetaSlot={<div data-testid="left-meta">L</div>}
        rightMetaSlot={<div data-testid="right-meta">R</div>}
        leftKeepSlot={<button data-testid="left-keep">Keep L</button>}
        rightKeepSlot={<button data-testid="right-keep">Keep R</button>}
      />
    </LangProvider>
  );
}

async function waitBothReady() {
  // Le NativeComparatorBody charge le fichier sur chaque cote des que l'id est dispo.
  // Quand les 2 loads sont vus, les deux NativeVideo sont prets.
  await waitFor(() => {
    const loadCalls = mockInvoke.mock.calls.filter((c) => c[0] === "native_player_load");
    expect(loadCalls.length).toBe(2);
  });
}

describe("NativeComparatorBody", () => {
  it("rend deux NativeVideo (gauche audio, droite muette) + meta slots + barre", async () => {
    renderBody();
    expect(screen.getByTestId("native-video-left")).toBeInTheDocument();
    expect(screen.getByTestId("native-video-right")).toBeInTheDocument();
    expect(screen.getByTestId("left-meta")).toBeInTheDocument();
    expect(screen.getByTestId("right-meta")).toBeInTheDocument();
    expect(screen.getByTestId("native-controls")).toBeInTheDocument();
    // L'audio est demande true a gauche, false a droite.
    await waitFor(() => {
      const createCalls = mockInvoke.mock.calls.filter((c) => c[0] === "native_player_create");
      expect(createCalls).toHaveLength(2);
      expect(createCalls[0][1]).toMatchObject({ audio: true });
      expect(createCalls[1][1]).toMatchObject({ audio: false });
    });
  });

  it("charge le fichier de chaque cote avec le bon path", async () => {
    renderBody();
    await waitBothReady();
    const loadCalls = mockInvoke.mock.calls.filter((c) => c[0] === "native_player_load");
    const paths = loadCalls.map((c) => (c[1] as { path: string }).path).sort();
    expect(paths).toEqual(["/videos/left.wmv", "/videos/right.avi"]);
  });

  it("applique le volume initial (100) sur le master quand il est pret", async () => {
    renderBody();
    await waitFor(() => {
      const volCalls = mockInvoke.mock.calls.filter((c) => c[0] === "native_player_set_volume");
      expect(volCalls.length).toBeGreaterThanOrEqual(1);
      // Le set_volume vise uniquement le master (id=1).
      expect(volCalls[0][1]).toMatchObject({ id: 1, volume: 100 });
    });
  });

  it("change le volume quand le slider bouge", async () => {
    renderBody();
    await waitBothReady();
    const slider = screen.getByLabelText("Volume") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "42" } });
    await waitFor(() => {
      const volCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "native_player_set_volume" && (c[1] as { volume: number }).volume === 42
      );
      expect(volCalls.length).toBeGreaterThan(0);
    });
  });

  it("clic sur Play (etat pause) invoque play_pair sur les deux ids", async () => {
    renderBody();
    await waitBothReady();
    // Bouton play (▶) actif car state.paused=true par defaut.
    const playBtn = screen.getByRole("button", { name: /Lecture|Play/ });
    fireEvent.click(playBtn);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c) => c[0] === "native_player_play_pair");
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toMatchObject({ left: 1, right: 2 });
    });
  });

  it("clic sur Pause (etat playing) invoque pause_pair sur les deux ids", async () => {
    stateOverride = { paused: false };
    renderBody();
    await waitBothReady();
    // Le polling va eventuellement detecter paused=false et afficher le bouton pause.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Pause/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Pause/ }));
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c) => c[0] === "native_player_pause_pair");
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toMatchObject({ left: 1, right: 2 });
    });
  });

  it("relacher le scrubber appelle seek_pair avec le time du slider", async () => {
    renderBody();
    await waitBothReady();
    // Le scrubber se rend en input range non-volume (le 1er input range, vol est le 2eme).
    const inputs = screen.getAllByRole("slider");
    const scrubber = inputs.find((el) => el.className.includes("scrubber")) as HTMLInputElement;
    expect(scrubber).toBeDefined();
    // Drag du scrubber : on change la valeur, puis on relache (mouseUp).
    fireEvent.mouseDown(scrubber);
    fireEvent.change(scrubber, { target: { value: "30" } });
    fireEvent.mouseUp(scrubber);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c) => c[0] === "native_player_seek_pair");
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toMatchObject({ left: 1, right: 2, time: 30 });
    });
  });

  it("polle l'etat du master via native_player_get_state apres mount", async () => {
    renderBody();
    await waitBothReady();
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c) => c[0] === "native_player_get_state");
      // Au moins 1 get_state au mount (vise toujours l'id du master = 1).
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][1]).toMatchObject({ id: 1 });
    });
  });
});
