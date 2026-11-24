// SI projects kept as one file (.chemsi): a zip of the project folder, as a .docx is a zip of
// Word's parts. Inside is exactly the folder Chem SI Assistant uses (project.json, sections/ and
// so on), so renaming the file to .zip and unzipping it gives that folder back.
//
// While a project file is open, Chemweave works in a copy of its folder unpacked into the app's
// own data folder (si-working/<id>/), so editing is as quick as in a folder project, and saving
// packs that folder back into the file. The copy stays after a crash, so its changes can be
// recovered; it is deleted when the project closes.
//
// Packing writes a new file beside the old one and then puts it in the old one's place, so a
// failure (a full disk, the computer turned off) never leaves half a project file.

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

use crate::folders::rename_retrying;

/// The project's own file, by which a project folder is known.
const PROJECT_FILE: &str = "project.json";
/// The most files a project file may hold (one with more is not an SI project).
const MAX_ENTRIES: usize = 200_000;
/// The most a project file may unpack to: 64 GB (a "zip bomb" stops here rather than filling the disk).
const MAX_UNPACKED: u64 = 64 << 30;
/// Files that are compressed already are stored as they are: compressing them again only takes time.
const STORED: &[&str] = &["pdf", "png", "jpg", "jpeg", "gif", "zip", "docx", "xlsx", "pptx", "7z", "gz", "mp4", "tif", "tiff", "webp", "chemsi", "cdx"];

/// Where unpacked project files are worked on (the app's own data folder).
fn working_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_local_data_dir().map_err(|e| format!("No data folder: {e}"))?;
    Ok(dir.join("si-working"))
}

/// Whether a path has no "." or ".." in it.
fn plain(p: &Path) -> bool {
    !p.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir))
}

/// A name for a new working folder: when, and which run of the app, so two never meet.
fn fresh_id() -> String {
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}-{}-{}", t.as_secs(), t.subsec_nanos(), std::process::id())
}

/// A file name that is safe on every system, for the folder the project is unpacked into
/// (its name is the project's name where project.json gives no title).
fn safe_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
    let s = s.trim().trim_end_matches('.').trim().to_string();
    if s.is_empty() { "SI Project".to_string() } else { s.chars().take(120).collect() }
}

/// Unpack the zip at `file` into `into` (which must not hold anything yet). Gives where the
/// project's own folder is in it: `into` itself, or the one folder inside that holds the
/// project.json (a zip of the folder, as Chem SI Assistant's snapshots are).
pub(crate) fn unpack(file: &Path, into: &Path) -> Result<PathBuf, String> {
    let f = std::fs::File::open(file).map_err(|e| format!("Could not open {}: {e}", file.display()))?;
    let mut zip = ZipArchive::new(std::io::BufReader::new(f)).map_err(|e| format!("{} is not an SI project file (it could not be read as a zip: {e}).", file.display()))?;
    if zip.len() > MAX_ENTRIES {
        return Err(format!("{} holds too many files ({}) to be an SI project.", file.display(), zip.len()));
    }
    std::fs::create_dir_all(into).map_err(|e| format!("Could not make the folder {}: {e}", into.display()))?;
    let mut total: u64 = 0;
    let mut buf = vec![0u8; 1 << 20];
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("{} could not be read (file {} of it: {e}).", file.display(), i + 1))?;
        // (a name that would leave the folder, "../x" or "/etc/x", is left out)
        let Some(rel) = entry.enclosed_name() else { continue };
        if !plain(&rel) || rel.as_os_str().is_empty() {
            continue;
        }
        let out = into.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("Could not make the folder {}: {e}", out.display()))?;
            continue;
        }
        if entry.is_symlink() {
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Could not make the folder {}: {e}", parent.display()))?;
        }
        let mut w = std::fs::File::create(&out).map_err(|e| format!("Could not write {}: {e}", out.display()))?;
        loop {
            let n = entry.read(&mut buf).map_err(|e| format!("{} could not be read ({}: {e}).", file.display(), rel.display()))?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > MAX_UNPACKED {
                return Err(format!("{} unpacks to more than 64 GB, so it was not opened.", file.display()));
            }
            w.write_all(&buf[..n]).map_err(|e| format!("Could not write {}: {e}", out.display()))?;
        }
        // (when it last changed, as the zip says, so the project's files keep their times)
        if let Some(t) = entry.last_modified().and_then(system_time) {
            let _ = w.set_modified(t);
        }
    }
    if into.join(PROJECT_FILE).is_file() {
        return Ok(into.to_path_buf());
    }
    // a zip of the project's folder: the one folder inside with a project.json
    let mut found: Vec<PathBuf> = std::fs::read_dir(into)
        .map_err(|e| format!("Could not read {}: {e}", into.display()))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.join(PROJECT_FILE).is_file())
        .collect();
    if found.len() == 1 {
        return Ok(found.remove(0));
    }
    Err(format!("{} is not an SI project file: it has no {PROJECT_FILE}.", file.display()))
}

/// The project folder's files, as paths from it ("/" between folders), sorted, leaving out
/// hidden files (the .lock, files being written), Office's owner files (~$…), and the top
/// folders named in `skip` (build/, Chemweave's own working files, always).
fn files_of(root: &Path, skip: &[String]) -> Result<Vec<(String, PathBuf)>, String> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, rel)) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| format!("Could not read the folder {}: {e}", dir.display()))?;
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.starts_with("~$") {
                continue;
            }
            if rel.is_empty() && (name == "build" || skip.iter().any(|s| s == &name)) {
                continue;
            }
            let Ok(kind) = e.file_type() else { continue };
            let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            // (links are not followed: a project's own files only)
            if kind.is_dir() {
                stack.push((e.path(), path));
            } else if kind.is_file() {
                out.push((path, e.path()));
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Pack the project folder `root` into a zip at `file`: written beside it under a hidden name,
/// then put in its place. Gives the file's size in bytes.
pub(crate) fn pack(root: &Path, file: &Path, skip: &[String]) -> Result<u64, String> {
    if !root.join(PROJECT_FILE).is_file() {
        return Err(format!("{} is not an SI project folder (it has no {PROJECT_FILE}).", root.display()));
    }
    let files = files_of(root, skip)?;
    let dir = file.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let base = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "project.chemsi".into());
    let temp = dir.join(format!(".{base}.saving-{}", fresh_id()));
    let result = (|| -> Result<u64, String> {
        let out = std::fs::File::create(&temp).map_err(|e| format!("Could not write in {}: {e}", dir.display()))?;
        let mut zip = ZipWriter::new(std::io::BufWriter::with_capacity(1 << 20, out));
        let mut buf = vec![0u8; 1 << 20];
        for (rel, path) in &files {
            let meta = std::fs::metadata(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
            let ext = Path::new(rel).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            let method = if STORED.contains(&ext.as_str()) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
            let mut opts = SimpleFileOptions::default()
                .compression_method(method)
                .unix_permissions(0o644)
                .large_file(meta.len() >= u32::MAX as u64);
            if let Some(t) = meta.modified().ok().and_then(zip_time) {
                opts = opts.last_modified_time(t);
            }
            zip.start_file(rel.as_str(), opts).map_err(|e| format!("Could not pack {rel}: {e}"))?;
            let mut r = std::fs::File::open(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
            loop {
                let n = r.read(&mut buf).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
                if n == 0 {
                    break;
                }
                zip.write_all(&buf[..n]).map_err(|e| format!("Could not write {}: {e}", file.display()))?;
            }
        }
        let w = zip.finish().map_err(|e| format!("Could not write {}: {e}", file.display()))?;
        let out = w.into_inner().map_err(|e| format!("Could not write {}: {e}", file.display()))?;
        out.sync_all().map_err(|e| format!("Could not write {}: {e}", file.display()))?;
        let size = out.metadata().map(|m| m.len()).unwrap_or(0);
        drop(out);
        // (a check that what was written reads back as the project, before it replaces anything)
        let check = std::fs::File::open(&temp).map_err(|e| format!("Could not read back {}: {e}", temp.display()))?;
        let back = ZipArchive::new(std::io::BufReader::new(check)).map_err(|e| format!("The saved file did not read back ({e}), so {} was left as it was.", file.display()))?;
        if back.len() != files.len() {
            return Err(format!("The saved file did not read back whole, so {} was left as it was.", file.display()));
        }
        Ok(size)
    })();
    match result {
        Ok(size) => match rename_retrying(&temp, file) {
            Ok(()) => Ok(size),
            Err(e) => {
                let _ = std::fs::remove_file(&temp);
                Err(format!("Could not save {}: {e}", file.display()))
            }
        },
        Err(e) => {
            let _ = std::fs::remove_file(&temp);
            Err(e)
        }
    }
}

/// When a zip entry last changed, read as UTC (as it was written).
fn system_time(t: DateTime) -> Option<SystemTime> {
    let days = days_from_civil(t.year() as i64, t.month() as i64, t.day() as i64);
    let secs = days * 86_400 + t.hour() as i64 * 3600 + t.minute() as i64 * 60 + t.second() as i64;
    (secs >= 0).then(|| UNIX_EPOCH + Duration::from_secs(secs as u64))
}

/// A file's time as a zip entry's (UTC; zips can't hold times before 1980).
fn zip_time(t: SystemTime) -> Option<DateTime> {
    let secs = t.duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let s = secs.rem_euclid(86_400);
    DateTime::from_date_and_time(y as u16, m as u8, d as u8, (s / 3600) as u8, (s % 3600 / 60) as u8, (s % 60) as u8).ok()
}

/// Days since 1970-01-01 of a date (H. Hinnant's algorithm, proleptic Gregorian).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The date of a day counted from 1970-01-01 (the inverse of `days_from_civil`).
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

/// Whether `dir` is one working folder directly inside the working root.
fn is_working(root: &Path, dir: &Path) -> bool {
    plain(dir) && dir.parent() == Some(root) && dir.file_name().is_some()
}

/// Open an SI project file: unpack it into a new working folder. Gives the working folder (to
/// discard when the project closes) and the project's own folder in it.
#[tauri::command]
pub fn si_unpack(app: tauri::AppHandle, file: String, name: Option<String>) -> Result<serde_json::Value, String> {
    let root = working_root(&app)?;
    let working = root.join(fresh_id());
    // (the project's folder is named as the file is, so a project with no title is called that)
    let stem = name.unwrap_or_else(|| Path::new(&file).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default());
    let into = working.join(safe_name(&stem));
    match unpack(Path::new(&file), &into) {
        Ok(project) => Ok(serde_json::json!({ "working": working.to_string_lossy(), "root": project.to_string_lossy() })),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&working);
            Err(e)
        }
    }
}

/// Make a new, empty working folder for a project not saved as a file yet (File ▸ New SI
/// Project): gives the working folder and the project's folder in it (made, empty).
#[tauri::command]
pub fn si_new_working(app: tauri::AppHandle, name: String) -> Result<serde_json::Value, String> {
    let working = working_root(&app)?.join(fresh_id());
    let project = working.join(safe_name(&name));
    std::fs::create_dir_all(&project).map_err(|e| format!("Could not make the folder {}: {e}", project.display()))?;
    Ok(serde_json::json!({ "working": working.to_string_lossy(), "root": project.to_string_lossy() }))
}

/// Save an SI project folder (a working folder, or a folder project for Save As) as one file.
/// `skip`: more top folders of the project to leave out. Gives the file's size in bytes.
#[tauri::command]
pub async fn si_pack(root: String, file: String, skip: Option<Vec<String>>) -> Result<u64, String> {
    let skip = skip.unwrap_or_default();
    let shown = file.clone();
    // (off the main thread: a large project takes a moment)
    tauri::async_runtime::spawn_blocking(move || pack(Path::new(&root), Path::new(&file), &skip))
        .await
        .map_err(|e| format!("Could not save {shown}: {e}"))?
}

/// Unpack an SI project file into a folder the person chose (File ▸ Save As ▸ SI Project Folder,
/// for Chem SI Assistant): `into` must not be there yet, or be an empty folder.
#[tauri::command]
pub async fn si_unpack_to(file: String, into: String) -> Result<String, String> {
    let shown = file.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let to = PathBuf::from(&into);
        if to.exists() && std::fs::read_dir(&to).map(|mut d| d.next().is_some()).unwrap_or(true) {
            return Err(format!("{into} is there already and is not empty: choose a new folder."));
        }
        unpack(Path::new(&file), &to).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("Could not unpack {shown}: {e}"))?
}

/// Delete a working folder (the project closed, or its recovered changes were saved or
/// discarded). Only a folder directly inside Chemweave's own si-working folder is deleted here.
#[tauri::command]
pub fn si_discard_working(app: tauri::AppHandle, working: String) -> Result<(), String> {
    let root = working_root(&app)?;
    let dir = PathBuf::from(&working);
    if !is_working(&root, &dir) {
        return Err(format!("not an SI working folder: {working}"));
    }
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete {working}: {e}")),
    }
}

/// The working folders left from earlier (a crash, or the app closed before a project was
/// saved), for recovery: each folder's path and when it last changed (ms since 1970).
#[tauri::command]
pub fn si_list_working(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let root = working_root(&app)?;
    let Ok(entries) = std::fs::read_dir(&root) else { return Ok(serde_json::json!([])) };
    let mut out = Vec::new();
    for e in entries.flatten() {
        if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let modified = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        out.push(serde_json::json!({ "working": e.path().to_string_lossy(), "modified": modified }));
    }
    Ok(serde_json::Value::Array(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ci-si-file-{tag}-{}", fresh_id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn dates_round_trip() {
        // 2026-11-24 21:57:32 UTC is 1795557452 seconds after 1970 (date -u -d @1795557452)
        let t = UNIX_EPOCH + Duration::from_secs(1_795_557_452);
        let z = zip_time(t).unwrap();
        assert_eq!((z.year(), z.month(), z.day(), z.hour(), z.minute(), z.second()), (2026, 11, 24, 21, 57, 32));
        assert_eq!(system_time(z), Some(t));
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(days_from_civil(2000, 2, 29)), (2000, 2, 29));
    }

    #[test]
    fn packs_and_unpacks_a_project() {
        let base = tmp("pack");
        let p = base.join("NaBH4 SI");
        std::fs::create_dir_all(p.join("sections/01_general")).unwrap();
        std::fs::create_dir_all(p.join("build/chemweave-undo")).unwrap();
        std::fs::write(p.join("project.json"), br#"{"title":"NaBH4 SI"}"#).unwrap();
        std::fs::write(p.join("sections/01_general/text.md"), "Reactions were run under N\u{2082}.").unwrap();
        std::fs::write(p.join("sections/01_general/spectrum.pdf"), vec![7u8; 300_000]).unwrap();
        std::fs::write(p.join(".lock"), "someone").unwrap();
        std::fs::write(p.join("build/out.docx"), "built").unwrap();
        std::fs::write(p.join("~$draft.docx"), "owner").unwrap();
        std::fs::create_dir_all(p.join("snapshots")).unwrap();
        std::fs::write(p.join("snapshots/a.zip"), "zip").unwrap();
        let file = base.join("NaBH4 SI.chemsi");
        pack(&p, &file, &["snapshots".to_string()]).unwrap();
        // nothing of the temporary file is left
        let left: Vec<_> = std::fs::read_dir(&base).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(left.iter().all(|n| !n.contains("saving")), "{left:?}");
        let mut zip = ZipArchive::new(std::fs::File::open(&file).unwrap()).unwrap();
        let names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().unwrap().to_string()).collect();
        assert_eq!(names, vec!["project.json", "sections/01_general/spectrum.pdf", "sections/01_general/text.md"]);
        assert_eq!(zip.by_name("sections/01_general/spectrum.pdf").unwrap().compression(), CompressionMethod::Stored);
        assert_eq!(zip.by_name("project.json").unwrap().compression(), CompressionMethod::Deflated);
        let out = base.join("open");
        let root = unpack(&file, &out).unwrap();
        assert_eq!(root, out);
        assert_eq!(std::fs::read_to_string(root.join("sections/01_general/text.md")).unwrap(), "Reactions were run under N\u{2082}.");
        assert_eq!(std::fs::read(root.join("sections/01_general/spectrum.pdf")).unwrap().len(), 300_000);
        // saving again over the file replaces it
        std::fs::write(p.join("project.json"), br#"{"title":"Changed"}"#).unwrap();
        pack(&p, &file, &[]).unwrap();
        let out2 = base.join("open2");
        unpack(&file, &out2).unwrap();
        assert_eq!(std::fs::read_to_string(out2.join("project.json")).unwrap(), r#"{"title":"Changed"}"#);
        assert!(out2.join("snapshots/a.zip").is_file());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn opens_a_zip_of_the_folder_and_refuses_others() {
        let base = tmp("wrap");
        let file = base.join("snap.zip");
        {
            let mut z = ZipWriter::new(std::fs::File::create(&file).unwrap());
            let o = SimpleFileOptions::default();
            z.start_file("My SI/project.json", o).unwrap();
            z.write_all(b"{}").unwrap();
            z.start_file("../escape.txt", o).unwrap();
            z.write_all(b"x").unwrap();
            z.finish().unwrap();
        }
        let root = unpack(&file, &base.join("w")).unwrap();
        assert_eq!(root, base.join("w").join("My SI"));
        assert!(!base.join("escape.txt").exists());
        let other = base.join("other.zip");
        {
            let mut z = ZipWriter::new(std::fs::File::create(&other).unwrap());
            z.start_file("readme.txt", SimpleFileOptions::default()).unwrap();
            z.write_all(b"hi").unwrap();
            z.finish().unwrap();
        }
        assert!(unpack(&other, &base.join("w2")).unwrap_err().contains("not an SI project file"));
        assert!(unpack(&base.join("missing.chemsi"), &base.join("w3")).is_err());
        // a folder that isn't a project is not packed
        assert!(pack(&base.join("w2"), &base.join("x.chemsi"), &[]).is_err());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn only_working_folders_are_discarded() {
        let root = PathBuf::from("/data/si-working");
        assert!(is_working(&root, &root.join("123-4-5")));
        assert!(!is_working(&root, &root));
        assert!(!is_working(&root, &root.join("123/x")));
        assert!(!is_working(&root, &root.join("..")));
        assert!(!is_working(&root, Path::new("/home/me/Documents")));
    }
}
