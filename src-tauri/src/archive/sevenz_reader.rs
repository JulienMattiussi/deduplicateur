use std::path::Path;
use crate::archive::ArchiveEntry;

pub fn hash_sevenz_entries(path: &Path) -> Result<Vec<ArchiveEntry>, String> {
    // TODO: API sevenz-rust - for_each_entries requiert une signature HRTB incompatible
    // avec le borrow checker en Rust stable. A implementer quand l'API sera stabilisee.
    // Le format 7z est detecte mais son contenu n'est pas compare pour l'instant.
    let _ = path;
    Ok(vec![])
}
