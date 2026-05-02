import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ScanProfile } from "../types";

export function useProfiles() {
  const [profiles, setProfiles] = useState<ScanProfile[]>([]);

  useEffect(() => {
    invoke<ScanProfile[]>("list_profiles").then(setProfiles).catch(() => {});
  }, []);

  async function saveProfile(profile: Omit<ScanProfile, "id" | "created_at">): Promise<void> {
    const saved = await invoke<ScanProfile>("save_profile", {
      profile: { ...profile, id: "", created_at: 0 },
    });
    setProfiles((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
  }

  async function deleteProfile(id: string): Promise<void> {
    await invoke("delete_profile", { id });
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  }

  return { profiles, saveProfile, deleteProfile };
}
