use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveEntryResult {
    pub internal_path: String,
    pub size: u64,
    /// "duplicate" ou "unique"
    pub status: String,
    /// Chemin interne dans l'autre archive si status == "duplicate"
    pub duplicate_in: Option<String>,
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
