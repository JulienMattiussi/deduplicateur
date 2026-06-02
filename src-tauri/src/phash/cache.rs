use std::collections::HashMap;
use std::io::{BufWriter, Write};
use std::path::Path;
use serde::{Deserialize, Serialize};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use crate::cache_io::load_json_map;

/// Entree de cache pour un fichier image.
/// Les hashs sont stockes en base64 pour la compatibilite JSON.
/// Les tailles de hash et thumbnail_setting font partie de la cle d'invalidation.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CacheEntry {
    /// Date de modification du fichier au moment du calcul (secondes Unix).
    pub mtime: u64,
    /// Taille NxN du hash grossier au moment du calcul.
    pub coarse_size: u32,
    /// Taille NxN du hash fin au moment du calcul.
    pub fine_size: u32,
    /// Hash grossier (coarse) encode en base64.
    pub coarse: String,
    /// Hash fin (fine) encode en base64.
    pub fine: String,
    /// Ratio largeur/hauteur de l'image (w/h). None pour les anciennes entrees de cache.
    #[serde(default)]
    pub aspect: Option<f32>,
    /// Valeur de use_exif_thumbnail au moment du calcul.
    /// Invalide l'entree si l'option change entre deux scans pour garantir la coherence des hashs.
    /// false pour les anciennes entrees (compatibilite ascendante).
    #[serde(default)]
    pub thumbnail_setting: bool,
}

// --- Format binaire phash_cache.bin ---
//
// Header (9 octets):
//   magic   : [u8; 4] = b"PHCB"
//   version : u8 = 1
//   count   : u32 LE
//
// Par entree :
//   path_len       : u16 LE
//   path           : [u8; path_len]  (UTF-8)
//   mtime          : u64 LE
//   coarse_size    : u8  (taille NxN)
//   fine_size      : u8  (taille NxN)
//   coarse_len     : u8  (nombre d'octets du hash grossier brut)
//   coarse         : [u8; coarse_len]
//   fine_len       : u8  (nombre d'octets du hash fin brut)
//   fine           : [u8; fine_len]
//   flags          : u8  (bit 0 = thumbnail_setting, bit 1 = has_aspect)
//   [aspect        : f32 LE, seulement si bit 1 de flags est 1]
//
// Taille typique par entree (chemin 50 car, coarse 4x4, fine 8x8, avec aspect) :
//   2 + 50 + 8 + 1 + 1 + 1 + 2 + 1 + 8 + 1 + 4 = 79 octets  (vs ~350 en JSON)

fn save_binary_cache(entries: &HashMap<String, CacheEntry>, data_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let file = std::fs::File::create(data_dir.join("phash_cache.bin")).map_err(|e| e.to_string())?;
    let mut w = BufWriter::new(file);

    w.write_all(b"PHCB").map_err(|e| e.to_string())?;
    w.write_all(&[1u8]).map_err(|e| e.to_string())?;
    w.write_all(&(entries.len() as u32).to_le_bytes()).map_err(|e| e.to_string())?;

    for (key, entry) in entries {
        let kb = key.as_bytes();
        let kl = kb.len().min(65535) as u16;
        w.write_all(&kl.to_le_bytes()).map_err(|e| e.to_string())?;
        w.write_all(&kb[..kl as usize]).map_err(|e| e.to_string())?;

        w.write_all(&entry.mtime.to_le_bytes()).map_err(|e| e.to_string())?;
        w.write_all(&[entry.coarse_size.min(255) as u8]).map_err(|e| e.to_string())?;
        w.write_all(&[entry.fine_size.min(255) as u8]).map_err(|e| e.to_string())?;

        let cb = BASE64.decode(&entry.coarse).unwrap_or_default();
        let cl = cb.len().min(255) as u8;
        w.write_all(&[cl]).map_err(|e| e.to_string())?;
        w.write_all(&cb[..cl as usize]).map_err(|e| e.to_string())?;

        let fb = BASE64.decode(&entry.fine).unwrap_or_default();
        let fl = fb.len().min(255) as u8;
        w.write_all(&[fl]).map_err(|e| e.to_string())?;
        w.write_all(&fb[..fl as usize]).map_err(|e| e.to_string())?;

        let mut flags: u8 = 0;
        if entry.thumbnail_setting { flags |= 0x01; }
        if entry.aspect.is_some() { flags |= 0x02; }
        w.write_all(&[flags]).map_err(|e| e.to_string())?;

        if let Some(asp) = entry.aspect {
            w.write_all(&asp.to_le_bytes()).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn load_binary_cache(data_dir: &Path) -> Option<HashMap<String, CacheEntry>> {
    let data = std::fs::read(data_dir.join("phash_cache.bin")).ok()?;
    if data.len() < 9 || &data[0..4] != b"PHCB" || data[4] != 1 {
        return None;
    }

    let count = u32::from_le_bytes([data[5], data[6], data[7], data[8]]) as usize;
    let mut entries = HashMap::with_capacity(count);
    let mut i = 9usize;

    for _ in 0..count {
        if i + 2 > data.len() { return None; }
        let kl = u16::from_le_bytes([data[i], data[i + 1]]) as usize;
        i += 2;
        if i + kl > data.len() { return None; }
        let key = std::str::from_utf8(&data[i..i + kl]).ok()?.to_string();
        i += kl;

        if i + 8 > data.len() { return None; }
        let mtime = u64::from_le_bytes(data[i..i + 8].try_into().ok()?);
        i += 8;

        if i + 2 > data.len() { return None; }
        let coarse_size = data[i] as u32;
        let fine_size = data[i + 1] as u32;
        i += 2;

        if i + 1 > data.len() { return None; }
        let cl = data[i] as usize;
        i += 1;
        if i + cl > data.len() { return None; }
        let coarse = BASE64.encode(&data[i..i + cl]);
        i += cl;

        if i + 1 > data.len() { return None; }
        let fl = data[i] as usize;
        i += 1;
        if i + fl > data.len() { return None; }
        let fine = BASE64.encode(&data[i..i + fl]);
        i += fl;

        if i + 1 > data.len() { return None; }
        let flags = data[i];
        i += 1;
        let thumbnail_setting = (flags & 0x01) != 0;

        let aspect = if (flags & 0x02) != 0 {
            if i + 4 > data.len() { return None; }
            let v = f32::from_le_bytes(data[i..i + 4].try_into().ok()?);
            i += 4;
            Some(v)
        } else {
            None
        };

        entries.insert(key, CacheEntry { mtime, coarse_size, fine_size, coarse, fine, aspect, thumbnail_setting });
    }

    Some(entries)
}

/// Cache des hashs pHash entre les scans.
/// Cle : chemin absolu du fichier.
/// Invalide automatiquement les entrees dont le mtime, les tailles de hash ou thumbnail_setting ont change.
/// Persistance en format binaire (phash_cache.bin) avec repli en lecture sur l'ancien format JSON.
pub struct HashCache {
    entries: HashMap<String, CacheEntry>,
    dirty: bool,
}

impl HashCache {
    /// Charge le cache depuis <data_dir>/phash_cache.bin (format binaire).
    /// Repli sur phash_cache.json si le fichier binaire est absent ou invalide.
    /// Retourne un cache vide si aucun fichier n'est present ou si les deux sont invalides.
    pub fn load(data_dir: &Path) -> Self {
        if let Some(entries) = load_binary_cache(data_dir) {
            return HashCache { entries, dirty: false };
        }
        HashCache { entries: load_json_map(data_dir, "phash_cache.json"), dirty: false }
    }

    /// Retourne un cache vide sans fichier associe.
    pub fn empty() -> Self {
        HashCache { entries: HashMap::new(), dirty: false }
    }

    /// Sauvegarde le cache en format binaire si des modifications ont ete apportees.
    /// Ne fait rien si `dirty == false`.
    pub fn save(&mut self, data_dir: &Path) -> Result<(), String> {
        if !self.dirty { return Ok(()); }
        save_binary_cache(&self.entries, data_dir)?;
        self.dirty = false;
        Ok(())
    }

    /// Retourne l'entree si elle existe et si mtime, tailles de hash ET thumbnail_setting correspondent.
    /// Retourne None si le fichier a ete modifie ou si la config a change.
    pub fn get(
        &self,
        path: &str,
        mtime: u64,
        coarse_size: u32,
        fine_size: u32,
        use_exif_thumbnail: bool,
    ) -> Option<&CacheEntry> {
        self.entries.get(path).filter(|e| {
            e.mtime == mtime
                && e.coarse_size == coarse_size
                && e.fine_size == fine_size
                && e.thumbnail_setting == use_exif_thumbnail
        })
    }

    /// Insere ou met a jour une entree. Marque le cache comme modifie.
    pub fn insert(&mut self, path: String, entry: CacheEntry) {
        self.entries.insert(path, entry);
        self.dirty = true;
    }

    /// Retire les entrees dont le fichier a disparu (volume joignable). Marque le
    /// cache dirty si au moins une entree est retiree. Retourne le nombre retire.
    pub fn prune_missing(&mut self) -> usize {
        let n = crate::maintenance::retain_existing(&mut self.entries);
        if n > 0 {
            self.dirty = true;
        }
        n
    }

    /// Nombre d'entrees obsoletes (fichier disparu, volume joignable) sans modifier le cache.
    pub fn count_missing(&self) -> usize {
        crate::maintenance::count_purgeable(self.entries.keys().map(|s| s.as_str()))
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_entry(mtime: u64) -> CacheEntry {
        CacheEntry {
            mtime,
            coarse_size: 4,
            fine_size: 8,
            coarse: "ABCD".to_string(),
            fine: "ABCDEF0123456789".to_string(),
            aspect: None,
            thumbnail_setting: false,
        }
    }

    #[test]
    fn cache_vide_si_fichier_absent() {
        let dir = TempDir::new().unwrap();
        let cache = HashCache::load(dir.path());
        assert!(cache.is_empty());
        assert!(!cache.dirty);
    }

    #[test]
    fn empty_retourne_cache_sans_entrees() {
        let cache = HashCache::empty();
        assert!(cache.is_empty());
        assert!(!cache.dirty);
    }

    #[test]
    fn insert_marque_dirty() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1000));
        assert!(cache.dirty);
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn get_retourne_entree_si_mtime_et_tailles_corrects() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1000));
        let entry = cache.get("/img/a.jpg", 1000, 4, 8, false);
        assert!(entry.is_some());
        assert_eq!(entry.unwrap().mtime, 1000);
    }

    #[test]
    fn get_retourne_none_si_mtime_different() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1000));
        assert!(cache.get("/img/a.jpg", 2000, 4, 8, false).is_none());
    }

    #[test]
    fn get_retourne_none_si_tailles_hash_differentes() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1000));
        assert!(cache.get("/img/a.jpg", 1000, 8, 8, false).is_none());
        assert!(cache.get("/img/a.jpg", 1000, 4, 16, false).is_none());
    }

    #[test]
    fn get_retourne_none_si_thumbnail_setting_different() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1000)); // thumbnail_setting = false
        // L'entree a ete calculee sans thumbnail (false), demander avec true = invalide
        assert!(cache.get("/img/a.jpg", 1000, 4, 8, true).is_none());
        assert!(cache.get("/img/a.jpg", 1000, 4, 8, false).is_some());
    }

    #[test]
    fn get_retourne_none_si_chemin_absent() {
        let dir = TempDir::new().unwrap();
        let cache = HashCache::load(dir.path());
        assert!(cache.get("/img/inexistant.jpg", 0, 4, 8, false).is_none());
    }

    #[test]
    fn save_ne_fait_rien_si_pas_dirty() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.save(dir.path()).unwrap();
        assert!(!dir.path().join("phash_cache.json").exists());
        assert!(!dir.path().join("phash_cache.bin").exists());
    }

    #[test]
    fn round_trip_save_load() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1111));
        cache.insert("/img/b.png".into(), make_entry(2222));
        cache.save(dir.path()).unwrap();
        assert!(!cache.dirty);

        let cache2 = HashCache::load(dir.path());
        assert_eq!(cache2.len(), 2);
        let e = cache2.get("/img/a.jpg", 1111, 4, 8, false).unwrap();
        assert_eq!(e.mtime, 1111);
        assert!(cache2.get("/img/b.png", 9999, 4, 8, false).is_none());
        assert!(cache2.get("/img/b.png", 2222, 4, 8, false).is_some());
    }

    #[test]
    fn save_ecrit_format_binaire_pas_json() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1000));
        cache.save(dir.path()).unwrap();
        assert!(dir.path().join("phash_cache.bin").exists());
        assert!(!dir.path().join("phash_cache.json").exists());
    }

    #[test]
    fn round_trip_avec_aspect_et_thumbnail_setting() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        let entry = CacheEntry {
            mtime: 9999,
            coarse_size: 4,
            fine_size: 8,
            coarse: "ABCD".to_string(),
            fine: "ABCDEF0123456789".to_string(),
            aspect: Some(1.777),
            thumbnail_setting: true,
        };
        cache.insert("/img/wide.jpg".into(), entry);
        cache.save(dir.path()).unwrap();

        let cache2 = HashCache::load(dir.path());
        let e = cache2.get("/img/wide.jpg", 9999, 4, 8, true).unwrap();
        assert_eq!(e.mtime, 9999);
        assert!(e.thumbnail_setting);
        assert!((e.aspect.unwrap() - 1.777).abs() < 1e-4);
        // Avec thumbnail_setting=false, l'entree est invalidee
        assert!(cache2.get("/img/wide.jpg", 9999, 4, 8, false).is_none());
    }

    #[test]
    fn compatibilite_repli_json() {
        let dir = TempDir::new().unwrap();
        // Ecrire manuellement un cache JSON (ancien format)
        let json = r#"{"/img/old.jpg":{"mtime":5000,"coarse_size":4,"fine_size":8,"coarse":"ABCD","fine":"ABCDEF0123456789","aspect":null,"thumbnail_setting":false}}"#;
        std::fs::write(dir.path().join("phash_cache.json"), json).unwrap();
        // Aucun fichier binaire : doit charger le JSON
        let cache = HashCache::load(dir.path());
        assert_eq!(cache.len(), 1);
        assert!(cache.get("/img/old.jpg", 5000, 4, 8, false).is_some());
    }

    #[test]
    fn binaire_prioritaire_sur_json() {
        let dir = TempDir::new().unwrap();
        // JSON avec une entree
        let json = r#"{"/img/json_only.jpg":{"mtime":1,"coarse_size":4,"fine_size":8,"coarse":"ABCD","fine":"ABCDEF0123456789","aspect":null,"thumbnail_setting":false}}"#;
        std::fs::write(dir.path().join("phash_cache.json"), json).unwrap();
        // Binaire independant (construit sans charger le JSON) avec une seule entree
        let mut entries = HashMap::new();
        entries.insert("/img/binary.jpg".into(), make_entry(2));
        save_binary_cache(&entries, dir.path()).unwrap();
        // Charger : doit lire le binaire (qui ne contient que binary.jpg, pas json_only.jpg)
        let cache2 = HashCache::load(dir.path());
        assert!(cache2.get("/img/binary.jpg", 2, 4, 8, false).is_some());
        assert!(cache2.get("/img/json_only.jpg", 1, 4, 8, false).is_none());
    }
}
