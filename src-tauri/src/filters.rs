use std::path::Path;

// Fonction utilitaire de filtrage : 9 criteres independants, regrouper dans un struct
// rendrait l'appel moins lisible aux call sites.
#[allow(clippy::too_many_arguments)]
pub fn passes_filters(
    path: &Path,
    size: u64,
    modified: u64,
    exclude_extensions: &[String],
    include_extensions: &[String],
    min_file_size_bytes: u64,
    max_file_size_bytes: u64,
    min_modified_timestamp: u64,
    max_modified_timestamp: u64,
) -> bool {
    if min_file_size_bytes > 0 && size < min_file_size_bytes {
        return false;
    }
    if max_file_size_bytes > 0 && size > max_file_size_bytes {
        return false;
    }
    if min_modified_timestamp > 0 && modified < min_modified_timestamp {
        return false;
    }
    if max_modified_timestamp > 0 && modified > max_modified_timestamp {
        return false;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !exclude_extensions.is_empty()
        && exclude_extensions.iter().any(|e| e.to_lowercase() == ext)
    {
        return false;
    }
    if !include_extensions.is_empty()
        && !include_extensions.iter().any(|e| e.to_lowercase() == ext)
    {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pf(path: &Path, size: u64, modified: u64, excl: &[String], incl: &[String], min_sz: u64, max_sz: u64, min_ts: u64, max_ts: u64) -> bool {
        passes_filters(path, size, modified, excl, incl, min_sz, max_sz, min_ts, max_ts)
    }

    #[test]
    fn passes_filters_sans_contrainte() {
        let path = Path::new("/some/file.txt");
        assert!(pf(path, 1024, 0, &[], &[], 0, 0, 0, 0));
    }

    #[test]
    fn passes_filters_taille_min_exclut() {
        let path = Path::new("/some/file.txt");
        assert!(!pf(path, 500, 0, &[], &[], 1024, 0, 0, 0));
    }

    #[test]
    fn passes_filters_taille_min_ok() {
        let path = Path::new("/some/file.txt");
        assert!(pf(path, 1024, 0, &[], &[], 1024, 0, 0, 0));
    }

    #[test]
    fn passes_filters_taille_max_exclut() {
        let path = Path::new("/some/file.txt");
        assert!(!pf(path, 2000, 0, &[], &[], 0, 1024, 0, 0));
    }

    #[test]
    fn passes_filters_taille_max_ok() {
        let path = Path::new("/some/file.txt");
        assert!(pf(path, 1024, 0, &[], &[], 0, 1024, 0, 0));
    }

    #[test]
    fn passes_filters_extension_exclue() {
        let path = Path::new("/some/file.tmp");
        let excl = vec!["tmp".to_string()];
        assert!(!pf(path, 100, 0, &excl, &[], 0, 0, 0, 0));
    }

    #[test]
    fn passes_filters_extension_exclue_insensible_casse() {
        let path = Path::new("/some/file.TMP");
        let excl = vec!["tmp".to_string()];
        assert!(!pf(path, 100, 0, &excl, &[], 0, 0, 0, 0));
    }

    #[test]
    fn passes_filters_extension_non_exclue_passe() {
        let path = Path::new("/some/file.txt");
        let excl = vec!["tmp".to_string()];
        assert!(pf(path, 100, 0, &excl, &[], 0, 0, 0, 0));
    }

    #[test]
    fn passes_filters_extension_incluse_match() {
        let path = Path::new("/some/file.jpg");
        let incl = vec!["jpg".to_string(), "png".to_string()];
        assert!(pf(path, 100, 0, &[], &incl, 0, 0, 0, 0));
    }

    #[test]
    fn passes_filters_extension_incluse_pas_match() {
        let path = Path::new("/some/file.txt");
        let incl = vec!["jpg".to_string(), "png".to_string()];
        assert!(!pf(path, 100, 0, &[], &incl, 0, 0, 0, 0));
    }

    #[test]
    fn passes_filters_date_min_exclut() {
        let path = Path::new("/some/file.txt");
        assert!(!pf(path, 100, 1000, &[], &[], 0, 0, 2000, 0));
    }

    #[test]
    fn passes_filters_date_min_ok() {
        let path = Path::new("/some/file.txt");
        assert!(pf(path, 100, 2000, &[], &[], 0, 0, 2000, 0));
    }

    #[test]
    fn passes_filters_date_max_exclut() {
        let path = Path::new("/some/file.txt");
        assert!(!pf(path, 100, 3000, &[], &[], 0, 0, 0, 2000));
    }

    #[test]
    fn passes_filters_date_max_ok() {
        let path = Path::new("/some/file.txt");
        assert!(pf(path, 100, 2000, &[], &[], 0, 0, 0, 2000));
    }

    #[test]
    fn passes_filters_date_plage() {
        let path = Path::new("/some/file.txt");
        assert!(pf(path, 100, 1500, &[], &[], 0, 0, 1000, 2000));
        assert!(!pf(path, 100, 500, &[], &[], 0, 0, 1000, 2000));
        assert!(!pf(path, 100, 2500, &[], &[], 0, 0, 1000, 2000));
    }
}
