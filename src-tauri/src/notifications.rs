//! Logique de notification de fin de scan (titre + corps + seuil).
//! Le call vers `app.notification().builder()` lui-meme reste dans `commands/scan.rs`
//! pour garder cette logique pure (testable sans Tauri).

pub fn should_notify(duration_ms: u128, threshold_secs: u64) -> bool {
    duration_ms >= (threshold_secs as u128) * 1000
}

pub fn format_notification_body(groups: usize, wasted_bytes: u64, lang: &str) -> String {
    let size_str = format_size_for_notif(wasted_bytes);
    if lang == "fr" {
        if groups == 0 {
            "Aucun doublon trouve.".to_string()
        } else if groups == 1 {
            format!("1 groupe trouve - {} recuperables", size_str)
        } else {
            format!("{} groupes trouves - {} recuperables", groups, size_str)
        }
    } else if groups == 0 {
        "No duplicates found.".to_string()
    } else if groups == 1 {
        format!("1 group found - {} recoverable", size_str)
    } else {
        format!("{} groups found - {} recoverable", groups, size_str)
    }
}

fn format_size_for_notif(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.1} GB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_notify_above_threshold() {
        assert!(should_notify(15_000, 10), "15s > seuil 10s");
        assert!(should_notify(10_000, 10), "exactement le seuil");
        assert!(should_notify(60_000, 10), "60s > seuil 10s");
    }

    #[test]
    fn should_notify_below_threshold() {
        assert!(!should_notify(9_999, 10), "9.999s < seuil 10s");
        assert!(!should_notify(0, 10), "0ms < seuil 10s");
        assert!(!should_notify(5_000, 10), "5s < seuil 10s");
    }

    #[test]
    fn should_notify_zero_threshold() {
        assert!(should_notify(0, 0), "seuil 0 = toujours notifier");
        assert!(should_notify(1, 0), "seuil 0 = toujours notifier");
    }

    #[test]
    fn format_notification_body_fr_no_groups() {
        let body = format_notification_body(0, 0, "fr");
        assert_eq!(body, "Aucun doublon trouve.");
    }

    #[test]
    fn format_notification_body_fr_one_group() {
        let body = format_notification_body(1, 2_097_152, "fr");
        assert!(body.contains("1 groupe"), "corps FR singulier");
        assert!(body.contains("2.0 MB"), "taille en MB");
    }

    #[test]
    fn format_notification_body_fr_many_groups() {
        let body = format_notification_body(42, 1_073_741_824, "fr");
        assert!(body.contains("42 groupes"), "corps FR pluriel");
        assert!(body.contains("1.0 GB"), "taille en GB");
    }

    #[test]
    fn format_notification_body_en_no_groups() {
        let body = format_notification_body(0, 0, "en");
        assert_eq!(body, "No duplicates found.");
    }

    #[test]
    fn format_notification_body_en_one_group() {
        let body = format_notification_body(1, 512 * 1024, "en");
        assert!(body.contains("1 group found"), "corps EN singulier");
        assert!(body.contains("512 KB"), "taille en KB");
    }

    #[test]
    fn format_notification_body_en_many_groups() {
        let body = format_notification_body(7, 1024, "en");
        assert!(body.contains("7 groups found"), "corps EN pluriel");
        assert!(body.contains("1 KB"), "taille 1 KB");
    }

    #[test]
    fn format_notification_body_unknown_lang_defaults_to_en() {
        let body = format_notification_body(3, 3_145_728, "de");
        assert!(body.contains("groups found"), "langue inconnue -> EN");
    }

    #[test]
    fn format_size_bytes() {
        let body = format_notification_body(1, 500, "en");
        assert!(body.contains("500 B"), "octets bruts");
    }
}
