import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderSection } from "./FolderSection";
import { LangProvider } from "../LangContext";
import type { DuplicateGroup, FolderSummary } from "../types";

const summary: FolderSummary = {
  folder_key: "Photos",
  group_count: 1,
  total_wasted_bytes: 1024,
};

const group: DuplicateGroup = {
  id: "g1",
  hash: "abc",
  size: 1024,
  files: [
    { path: "/a/photo.jpg", size: 1024, name: "photo.jpg", modified: 1700000000 },
    { path: "/b/photo.jpg", size: 1024, name: "photo.jpg", modified: 1700001000 },
  ],
};

function renderSection(onIgnore?: (id: string) => void) {
  const onExpand = vi.fn();
  render(
    <LangProvider>
      <FolderSection
        summary={summary}
        groups={[group]}
        loading={false}
        hasMore={false}
        selected={new Set()}
        onToggle={vi.fn()}
        onExpand={onExpand}
        onLoadMore={vi.fn()}
        onIgnore={onIgnore}
      />
    </LangProvider>
  );
  return onExpand;
}

describe("FolderSection - onIgnore", () => {
  it("le bouton ignorer est absent quand onIgnore n'est pas fourni", async () => {
    const user = userEvent.setup();
    renderSection(undefined);
    await user.click(screen.getByRole("button", { name: /Photos/ }));
    expect(screen.queryByTestId("ignore-group-btn")).not.toBeInTheDocument();
  });

  it("le bouton ignorer est présent quand onIgnore est fourni", async () => {
    const user = userEvent.setup();
    renderSection(vi.fn());
    await user.click(screen.getByRole("button", { name: /Photos/ }));
    expect(screen.getByTestId("ignore-group-btn")).toBeInTheDocument();
  });

  it("cliquer ignorer appelle onIgnore avec le bon group id", async () => {
    const user = userEvent.setup();
    const onIgnore = vi.fn();
    renderSection(onIgnore);
    await user.click(screen.getByRole("button", { name: /Photos/ }));
    await user.click(screen.getByTestId("ignore-group-btn"));
    expect(onIgnore).toHaveBeenCalledWith("g1");
  });
});
