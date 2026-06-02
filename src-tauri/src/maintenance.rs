//! Logique de purge long terme : distinguer un fichier reellement supprime d'un
//! fichier momentanement indisponible (disque externe debranche, NAS injoignable).
//!
//! Principe central (cf. AGENTS.md, regle "fichier absent != fichier supprime") :
//! on ne purge une reference (entree de cache, groupe ignore) que si le fichier
//! a disparu ET que son volume est joignable. Si la racine du volume elle-meme a
//! disparu (disque demonte), on GARDE la reference : le fichier pourrait revenir
//! au rebranchement, et re-hasher tout un disque externe par erreur serait un
//! footgun majeur.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Determine la racine du volume contenant `path`, quand elle est distincte du
/// disque systeme. Retourne `None` pour le disque systeme (suppose toujours
/// monte) : dans ce cas un fichier absent est forcement une vraie suppression.
#[cfg(windows)]
fn volume_root(path: &Path) -> Option<PathBuf> {
    use std::path::{Component, Prefix};
    let mut comps = path.components();
    match comps.next() {
        Some(Component::Prefix(prefix)) => {
            let mut root = PathBuf::from(prefix.as_os_str());
            match prefix.kind() {
                // Disque "C:" -> racine "C:\". On ajoute le RootDir.
                Prefix::Disk(_) | Prefix::VerbatimDisk(_) => root.push("\\"),
                // UNC "\\serveur\partage" : le prefixe est deja la racine du partage.
                _ => {}
            }
            Some(root)
        }
        _ => None,
    }
}

/// Variante Unix : detecte les points de montage externes courants. La profondeur
/// est le nombre de composants (apres `/`) qui forment le point de montage :
/// `/Volumes/<label>` (macOS) et `/mnt/<label>` -> 2 ; `/media/<user>/<label>` -> 3 ;
/// `/run/media/<user>/<label>` -> 4. Tout le reste (sous `/home`, `/`, etc.) est
/// considere comme disque systeme (`None`).
#[cfg(not(windows))]
fn volume_root(path: &Path) -> Option<PathBuf> {
    use std::path::Component;
    const MOUNTS: &[(&str, usize)] = &[
        ("/run/media/", 4),
        ("/media/", 3),
        ("/Volumes/", 2),
        ("/mnt/", 2),
    ];
    let s = path.to_string_lossy();
    for (prefix, depth) in MOUNTS {
        if s.starts_with(prefix) {
            let comps: Vec<Component> = path.components().collect();
            // comps[0] == RootDir ("/"). On reconstruit RootDir + `depth` composants.
            if comps.len() > *depth {
                let mut root = PathBuf::new();
                for c in comps.iter().take(depth + 1) {
                    root.push(c.as_os_str());
                }
                return Some(root);
            }
            // Le chemin EST le mount root (ou plus court) : pas de distinction utile.
            return None;
        }
    }
    None
}

/// Le volume contenant `path` est-il joignable ? Vrai pour le disque systeme,
/// vrai pour un volume externe dont la racine existe, faux si la racine du
/// volume externe a disparu (disque demonte).
pub fn is_volume_reachable(path: &Path) -> bool {
    match volume_root(path) {
        Some(root) => root.exists(),
        None => true,
    }
}

/// Une reference vers `path` est-elle purgeable ? Vrai uniquement si le fichier
/// n'existe plus ET que son volume est joignable. Un fichier sur un volume
/// demonte n'est PAS purgeable (on prefere garder une reference peut-etre encore
/// valide plutot que detruire un cache couteux a recalculer).
pub fn is_purgeable(path: &str) -> bool {
    let p = Path::new(path);
    if p.exists() {
        return false;
    }
    is_volume_reachable(p)
}

/// Un groupe ignore est obsolete si sa cle (chemins tries joints par `|`, cf.
/// `ignore_list::group_ignore_key`) reference au moins un fichier reellement
/// supprime (volume joignable) et AUCUN fichier sur un volume injoignable.
/// Rationnel : la cle exige le meme jeu exact de chemins pour re-matcher ; des
/// qu'un chemin est definitivement perdu, le groupe ne peut plus jamais se
/// reformer -> entree morte. Mais si un chemin est juste indisponible (disque
/// debranche), on ne peut pas conclure -> on garde.
pub fn ignore_key_is_stale(key: &str) -> bool {
    let mut any_dead = false;
    for raw in key.split('|') {
        let p = Path::new(raw);
        if p.exists() {
            continue;
        }
        if is_volume_reachable(p) {
            any_dead = true;
        } else {
            return false;
        }
    }
    any_dead
}

/// Retire d'une map `chemin -> valeur` toutes les entrees purgeables (fichier
/// disparu, volume joignable). Retourne le nombre d'entrees retirees. Partage par
/// les quatre caches de hash (cf. `HashCache::prune_missing`, etc.).
pub fn retain_existing<V>(entries: &mut HashMap<String, V>) -> usize {
    let before = entries.len();
    entries.retain(|p, _| !is_purgeable(p));
    before - entries.len()
}

/// Compte les cles purgeables d'un iterateur sans rien modifier (utilise pour le
/// rapport de maintenance : "X entrees obsoletes sur Y").
pub fn count_purgeable<'a, I: Iterator<Item = &'a str>>(keys: I) -> usize {
    keys.filter(|k| is_purgeable(k)).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn fichier_existant_non_purgeable() {
        let dir = TempDir::new().unwrap();
        let f = dir.path().join("present.txt");
        std::fs::write(&f, b"x").unwrap();
        assert!(!is_purgeable(f.to_str().unwrap()));
    }

    #[test]
    fn fichier_absent_volume_joignable_est_purgeable() {
        // Le repertoire temp existe (volume systeme joignable) mais pas le fichier.
        let dir = TempDir::new().unwrap();
        let missing = dir.path().join("disparu.txt");
        assert!(is_purgeable(missing.to_str().unwrap()));
    }

    #[cfg(not(windows))]
    #[test]
    fn fichier_sur_volume_demonte_non_purgeable() {
        // Chemin sous un point de montage externe inexistant : volume injoignable,
        // on garde meme si le fichier est absent.
        let path = "/media/nobody-xyz/UNMOUNTED-VOL-123/photos/img.jpg";
        assert!(!Path::new(path).exists());
        assert!(!is_volume_reachable(Path::new(path)));
        assert!(!is_purgeable(path));
    }

    #[cfg(not(windows))]
    #[test]
    fn fichier_absent_sur_volume_externe_monte_est_purgeable() {
        // On simule un volume externe MONTE : la racine existe (temp dir), le
        // fichier dessous non. Comme volume_root ne reconnait que /media etc., on
        // verifie ici plutot le cas "disque systeme" via un temp dir classique :
        // racine joignable -> purgeable.
        let dir = TempDir::new().unwrap();
        let sub = dir.path().join("sous/dossier");
        let missing = sub.join("x.jpg");
        assert!(is_purgeable(missing.to_str().unwrap()));
    }

    #[cfg(not(windows))]
    #[test]
    fn volume_root_detecte_les_points_de_montage() {
        assert_eq!(
            volume_root(Path::new("/media/julien/USBKEY/a/b.jpg")),
            Some(PathBuf::from("/media/julien/USBKEY"))
        );
        assert_eq!(
            volume_root(Path::new("/run/media/julien/DISK/a.jpg")),
            Some(PathBuf::from("/run/media/julien/DISK"))
        );
        assert_eq!(
            volume_root(Path::new("/mnt/data/a.jpg")),
            Some(PathBuf::from("/mnt/data"))
        );
        assert_eq!(
            volume_root(Path::new("/Volumes/Backup/a.jpg")),
            Some(PathBuf::from("/Volumes/Backup"))
        );
        // Disque systeme : pas de racine de volume distincte.
        assert_eq!(volume_root(Path::new("/home/julien/a.jpg")), None);
    }

    #[test]
    fn ignore_key_stale_si_un_chemin_supprime() {
        let dir = TempDir::new().unwrap();
        let present = dir.path().join("a.jpg");
        std::fs::write(&present, b"x").unwrap();
        let missing = dir.path().join("b.jpg");
        let key = format!("{}|{}", present.to_str().unwrap(), missing.to_str().unwrap());
        // b.jpg supprime, volume joignable -> la cle ne peut plus matcher -> obsolete.
        assert!(ignore_key_is_stale(&key));
    }

    #[test]
    fn ignore_key_non_stale_si_tous_presents() {
        let dir = TempDir::new().unwrap();
        let a = dir.path().join("a.jpg");
        let b = dir.path().join("b.jpg");
        std::fs::write(&a, b"x").unwrap();
        std::fs::write(&b, b"y").unwrap();
        let key = format!("{}|{}", a.to_str().unwrap(), b.to_str().unwrap());
        assert!(!ignore_key_is_stale(&key));
    }

    #[cfg(not(windows))]
    #[test]
    fn ignore_key_non_stale_si_un_chemin_sur_volume_demonte() {
        let dir = TempDir::new().unwrap();
        let present = dir.path().join("a.jpg");
        std::fs::write(&present, b"x").unwrap();
        // Deuxieme chemin sur un volume externe injoignable -> on ne conclut pas.
        let unmounted = "/media/nobody-xyz/UNMOUNTED/b.jpg";
        let key = format!("{}|{}", present.to_str().unwrap(), unmounted);
        assert!(!ignore_key_is_stale(&key));
    }

    #[test]
    fn retain_existing_retire_les_chemins_disparus() {
        let dir = TempDir::new().unwrap();
        let present = dir.path().join("a.txt");
        std::fs::write(&present, b"x").unwrap();
        let mut map: HashMap<String, u32> = HashMap::new();
        map.insert(present.to_str().unwrap().to_string(), 1);
        map.insert(dir.path().join("gone.txt").to_str().unwrap().to_string(), 2);
        let removed = retain_existing(&mut map);
        assert_eq!(removed, 1);
        assert_eq!(map.len(), 1);
        assert!(map.contains_key(present.to_str().unwrap()));
    }

    #[test]
    fn count_purgeable_compte_sans_modifier() {
        let dir = TempDir::new().unwrap();
        let present = dir.path().join("a.txt");
        std::fs::write(&present, b"x").unwrap();
        let gone = dir.path().join("gone.txt");
        let gone2 = dir.path().join("gone2.txt");
        let keys = vec![
            present.to_str().unwrap(),
            gone.to_str().unwrap(),
            gone2.to_str().unwrap(),
        ];
        assert_eq!(count_purgeable(keys.into_iter()), 2);
    }
}
