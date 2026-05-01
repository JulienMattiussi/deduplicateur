use std::path::Path;

pub fn passes_filters(
    path: &Path,
    size: u64,
    exclude_extensions: &[String],
    include_extensions: &[String],
    min_file_size_bytes: u64,
    max_file_size_bytes: u64,
) -> bool {
    if min_file_size_bytes > 0 && size < min_file_size_bytes {
        return false;
    }
    if max_file_size_bytes > 0 && size > max_file_size_bytes {
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

    #[test]
    fn passes_filters_sans_contrainte() {
        let path = Path::new("/some/file.txt");
        assert!(passes_filters(path, 1024, &[], &[], 0, 0));
    }

    #[test]
    fn passes_filters_taille_min_exclut() {
        let path = Path::new("/some/file.txt");
        assert!(!passes_filters(path, 500, &[], &[], 1024, 0));
    }

    #[test]
    fn passes_filters_taille_min_ok() {
        let path = Path::new("/some/file.txt");
        assert!(passes_filters(path, 1024, &[], &[], 1024, 0));
    }

    #[test]
    fn passes_filters_taille_max_exclut() {
        let path = Path::new("/some/file.txt");
        assert!(!passes_filters(path, 2000, &[], &[], 0, 1024));
    }

    #[test]
    fn passes_filters_taille_max_ok() {
        let path = Path::new("/some/file.txt");
        assert!(passes_filters(path, 1024, &[], &[], 0, 1024));
    }

    #[test]
    fn passes_filters_extension_exclue() {
        let path = Path::new("/some/file.tmp");
        let excl = vec!["tmp".to_string()];
        assert!(!passes_filters(path, 100, &excl, &[], 0, 0));
    }

    #[test]
    fn passes_filters_extension_exclue_insensible_casse() {
        let path = Path::new("/some/file.TMP");
        let excl = vec!["tmp".to_string()];
        assert!(!passes_filters(path, 100, &excl, &[], 0, 0));
    }

    #[test]
    fn passes_filters_extension_non_exclue_passe() {
        let path = Path::new("/some/file.txt");
        let excl = vec!["tmp".to_string()];
        assert!(passes_filters(path, 100, &excl, &[], 0, 0));
    }

    #[test]
    fn passes_filters_extension_incluse_match() {
        let path = Path::new("/some/file.jpg");
        let incl = vec!["jpg".to_string(), "png".to_string()];
        assert!(passes_filters(path, 100, &[], &incl, 0, 0));
    }

    #[test]
    fn passes_filters_extension_incluse_pas_match() {
        let path = Path::new("/some/file.txt");
        let incl = vec!["jpg".to_string(), "png".to_string()];
        assert!(!passes_filters(path, 100, &[], &incl, 0, 0));
    }
}
