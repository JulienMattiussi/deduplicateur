use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveEntryResult {
    pub internal_path: String,
    pub size: u64,
    /// "duplicate" (match exact xxh3) | "similar" (match pHash) | "unique"
    pub status: String,
    /// Chemin interne dans l'autre archive si status != "unique"
    pub duplicate_in: Option<String>,
    /// Hash xxh3 de l'entree (en hex), permet l'appariement greedy cote frontend
    /// quand plusieurs entrees partagent le meme hash dans une meme archive.
    pub hash: String,
    /// Score de similarite pHash (0..100, 100 = identique) si status == "similar".
    #[serde(default)]
    pub similarity_score: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveDetail {
    pub path: String,
    pub entries: Vec<ArchiveEntryResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveComparison {
    pub a: ArchiveDetail,
    pub b: ArchiveDetail,
}
