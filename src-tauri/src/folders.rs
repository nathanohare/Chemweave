// Folders the person picks: File > Find Structure in Files lists the drawings, documents,
// presentations and workbooks in one (and the folders inside it), and the library can be kept
// in one (OneDrive, a lab drive), which needs its Attachments folder made. Nothing here reads
// or changes a file; listing only says which files are there, how big, and when they changed.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The most files one listing gives (a whole drive picked by mistake stops here).
const MAX_FILES: usize = 20_000;
/// How deep into folders inside folders a listing goes.
const MAX_DEPTH: usize = 12;

/// Office's owner files (~$…), LibreOffice's and our lock files (.~lock.…#), and hidden files.
fn skipped(name: &str) -> bool {
    name.starts_with("~$") || name.starts_with('.')
}

fn wanted(path: &Path, extensions: &[String]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| extensions.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

fn walk(dir: &Path, depth: usize, extensions: &[String], sub: bool, out: &mut Vec<serde_json::Value>) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return true };
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut files: Vec<(PathBuf, std::fs::Metadata)> = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if skipped(&name) {
            continue;
        }
        // (a link to a folder is not followed, so a folder that holds itself can't loop)
        let Ok(kind) = e.file_type() else { continue };
        if kind.is_dir() {
            dirs.push(e.path());
        } else if kind.is_file() && wanted(&e.path(), extensions) {
            if let Ok(meta) = e.metadata() {
                files.push((e.path(), meta));
            }
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    for (p, meta) in files {
        if out.len() >= MAX_FILES {
            return false;
        }
        let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0);
        out.push(serde_json::json!({ "path": p.to_string_lossy(), "size": meta.len(), "modified": modified }));
    }
    if sub && depth < MAX_DEPTH {
        dirs.sort();
        for d in dirs {
            if !walk(&d, depth + 1, extensions, sub, out) {
                return false;
            }
        }
    }
    true
}

/// The files in a folder (and, with `sub`, the folders inside it) whose extension is one of
/// `extensions`, with their sizes and when they were last changed; `complete` is false when
/// there were more than the most one listing gives.
#[tauri::command(async)]
pub fn list_folder(path: String, extensions: Vec<String>, sub: bool) -> Result<serde_json::Value, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("{path} is not a folder (or can't be reached)."));
    }
    let mut files = Vec::new();
    let complete = walk(&dir, 0, &extensions, sub, &mut files);
    Ok(serde_json::json!({ "files": files, "complete": complete }))
}

/// Make a folder (and those it sits in) if it isn't there.
#[tauri::command]
pub fn make_folder(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Could not make the folder {path}: {e}"))
}

/// SI projects (Chem SI Assistant's folders): move a file or folder, such as a deleted compound
/// into the project's trash folder. Never writes over anything: `to` must not be there yet.
#[tauri::command]
pub fn si_move(from: String, to: String) -> Result<(), String> {
    let (f, t) = (PathBuf::from(&from), PathBuf::from(&to));
    if !f.exists() {
        return Err(format!("{from} is not there (it may have been moved or deleted)."));
    }
    if t.exists() {
        return Err(format!("{to} is already there."));
    }
    if let Some(parent) = t.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Could not make the folder {}: {e}", parent.display()))?;
    }
    std::fs::rename(&f, &t).map_err(|e| format!("Could not move {from}: {e}"))
}

/// SI projects: take away the project's ".lock" (who has it open) when it is closed. Only a
/// file called .lock beside a project.json is ever deleted here.
#[tauri::command]
pub fn si_remove_lock(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let is_lock = p.file_name().and_then(|n| n.to_str()) == Some(".lock") && p.parent().is_some_and(|d| d.join("project.json").is_file());
    if !is_lock {
        return Err(format!("not an SI project's lock: {path}"));
    }
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete {path}: {e}")),
    }
}

/// SI projects: the files and folders directly inside a folder of a project (its Trash, listed
/// in the Trash window), by name, each marked as a folder or not.
#[tauri::command]
pub fn si_list_dir(path: String) -> Result<serde_json::Value, String> {
    let dir = PathBuf::from(&path);
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("Could not read the folder {path}: {e}"))?;
    let mut out = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let folder = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(serde_json::json!({ "name": name, "folder": folder }));
    }
    Ok(serde_json::Value::Array(out))
}

/// Whether `p` is an SI project's trash folder, or one entry directly inside it (a project
/// folder is one with a project.json).
fn is_si_trash(p: &Path) -> bool {
    let named = |x: &Path, n: &str| x.file_name().and_then(|f| f.to_str()) == Some(n);
    let project = |x: Option<&Path>| x.is_some_and(|d| d.join("project.json").is_file());
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::CurDir)) {
        return false;
    }
    (named(p, "trash") && project(p.parent())) || p.parent().is_some_and(|t| named(t, "trash") && project(t.parent()))
}

/// SI projects: Empty Trash, or remove one item from it, in the Trash window. Only the
/// project's trash folder or an entry directly inside it is ever deleted here.
#[tauri::command]
pub fn si_remove_trash(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !is_si_trash(&p) {
        return Err(format!("not an SI project's Trash: {path}"));
    }
    match std::fs::remove_dir_all(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete {path}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_wanted_files_and_skips_owner_files() {
        let root = std::env::temp_dir().join(format!("ci-list-{}", std::process::id()));
        let inner = root.join("inner");
        std::fs::create_dir_all(&inner).unwrap();
        std::fs::write(root.join("a.cdxml"), "x").unwrap();
        std::fs::write(root.join("~$a.docx"), "x").unwrap();
        std::fs::write(root.join("b.txt"), "x").unwrap();
        std::fs::write(inner.join("c.DOCX"), "xy").unwrap();
        let exts = vec!["cdxml".to_string(), "docx".to_string()];
        let got = list_folder(root.to_string_lossy().into_owned(), exts.clone(), true).unwrap();
        let names: Vec<String> = got["files"].as_array().unwrap().iter().map(|f| Path::new(f["path"].as_str().unwrap()).file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["a.cdxml", "c.DOCX"]);
        assert_eq!(got["complete"], true);
        let top = list_folder(root.to_string_lossy().into_owned(), exts, false).unwrap();
        assert_eq!(top["files"].as_array().unwrap().len(), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn only_a_projects_trash_is_removed() {
        let root = std::env::temp_dir().join(format!("ci-si-trash-{}", std::process::id()));
        let entry = root.join("trash").join("20261118-x");
        std::fs::create_dir_all(&entry).unwrap();
        std::fs::write(entry.join("entry.json"), "{}").unwrap();
        std::fs::create_dir_all(root.join("sections")).unwrap();
        assert!(si_remove_trash(entry.to_string_lossy().into_owned()).is_err()); // no project.json yet
        std::fs::write(root.join("project.json"), "{}").unwrap();
        assert!(si_remove_trash(root.join("sections").to_string_lossy().into_owned()).is_err());
        let listed = si_list_dir(root.join("trash").to_string_lossy().into_owned()).unwrap();
        assert_eq!(listed[0]["folder"], true);
        si_remove_trash(entry.to_string_lossy().into_owned()).unwrap();
        assert!(!entry.exists() && root.join("trash").exists());
        si_remove_trash(root.join("trash").to_string_lossy().into_owned()).unwrap();
        assert!(!root.join("trash").exists() && root.join("sections").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
