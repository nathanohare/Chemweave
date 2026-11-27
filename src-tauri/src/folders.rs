// Folders the person picks: File > Find Structure in Files lists the drawings, documents,
// presentations and workbooks in one (and the folders inside it), and the library can be kept
// in one (OneDrive, a lab drive), which needs its Attachments folder made. Nothing here reads
// or changes a file; listing only says which files are there, how big, and when they changed.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The most files one listing gives (a whole drive picked by mistake stops here).
const MAX_FILES: usize = 20_000;
/// The most entries (files and folders, wanted or not) one listing looks at, so a huge tree with
/// few drawings in it (a backup drive, a node_modules) stops too, and says the list is partial.
const MAX_SEEN: usize = 500_000;
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

/// One listing in progress: what it looks for, what it has found, and whether it is whole.
struct Walk<'a> {
    extensions: &'a [String],
    sub: bool,
    max_files: usize,
    max_seen: usize,
    max_depth: usize,
    seen: usize,
    out: Vec<serde_json::Value>,
    /// False once something was left out (too many files or entries, or folders below the depth limit).
    complete: bool,
}

impl<'a> Walk<'a> {
    fn new(extensions: &'a [String], sub: bool) -> Self {
        Walk { extensions, sub, max_files: MAX_FILES, max_seen: MAX_SEEN, max_depth: MAX_DEPTH, seen: 0, out: Vec::new(), complete: true }
    }

    /// List one folder, then (with `sub`) those inside it. False means stop everything (a limit was reached).
    fn run(&mut self, dir: &Path, depth: usize) -> bool {
        let Ok(entries) = std::fs::read_dir(dir) else { return true };
        let mut dirs: Vec<PathBuf> = Vec::new();
        let mut files: Vec<(PathBuf, std::fs::Metadata)> = Vec::new();
        for e in entries.flatten() {
            self.seen += 1;
            if self.seen > self.max_seen {
                self.complete = false;
                return false;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            if skipped(&name) {
                continue;
            }
            // (a link to a folder is not followed, so a folder that holds itself can't loop)
            let Ok(kind) = e.file_type() else { continue };
            if kind.is_dir() {
                dirs.push(e.path());
            } else if kind.is_file() && wanted(&e.path(), self.extensions) {
                if let Ok(meta) = e.metadata() {
                    files.push((e.path(), meta));
                }
            }
        }
        files.sort_by(|a, b| a.0.cmp(&b.0));
        for (p, meta) in files {
            if self.out.len() >= self.max_files {
                self.complete = false;
                return false;
            }
            let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0);
            self.out.push(serde_json::json!({ "path": p.to_string_lossy(), "size": meta.len(), "modified": modified }));
        }
        if self.sub && !dirs.is_empty() {
            if depth >= self.max_depth {
                // folders below the limit are not looked into: the list is not the whole story
                self.complete = false;
                return true;
            }
            dirs.sort();
            for d in dirs {
                if !self.run(&d, depth + 1) {
                    return false;
                }
            }
        }
        true
    }
}

/// The files in a folder (and, with `sub`, the folders inside it) whose extension is one of
/// `extensions`, with their sizes and when they were last changed; `complete` is false when
/// the listing was cut short (more files than the most one listing gives, more entries than it
/// looks at, or folders deeper than it goes).
#[tauri::command(async)]
pub fn list_folder(path: String, extensions: Vec<String>, sub: bool) -> Result<serde_json::Value, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("{path} is not a folder (or can't be reached)."));
    }
    let mut walk = Walk::new(&extensions, sub);
    walk.run(&dir, 0);
    Ok(serde_json::json!({ "files": walk.out, "complete": walk.complete }))
}

/// Make a folder (and those it sits in) if it isn't there.
#[tauri::command]
pub fn make_folder(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Could not make the folder {path}: {e}"))
}

/// Another program (OneDrive, an antivirus, an indexer) may hold a file for a moment; on Windows
/// that makes a rename fail (access denied, or a sharing or lock violation). Such a failure is
/// tried again for about a second, as Chem SI Assistant does; any other failure is given at once.
pub(crate) fn rename_retrying(from: &Path, to: &Path) -> std::io::Result<()> {
    const ATTEMPTS: u32 = 10;
    let mut attempt = 1;
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if attempt < ATTEMPTS && held_for_a_moment(&e) => {
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(e),
        }
    }
}

fn held_for_a_moment(e: &std::io::Error) -> bool {
    // Windows: 5 access denied, 32 sharing violation, 33 lock violation
    e.kind() == std::io::ErrorKind::PermissionDenied || (cfg!(windows) && matches!(e.raw_os_error(), Some(5 | 32 | 33)))
}

/// Whether a path has no "." or ".." in it (so it is where it says it is).
fn plain(p: &Path) -> bool {
    !p.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::CurDir))
}

/// Whether `from` and `to` are both inside one SI project's folder (a folder with a project.json):
/// `root` when the page names it, else any folder above `from`.
fn in_one_project(from: &Path, to: &Path, root: Option<&Path>) -> bool {
    if !plain(from) || !plain(to) {
        return false;
    }
    let holds = |dir: &Path| dir.join("project.json").is_file() && from != dir && to != dir && from.starts_with(dir) && to.starts_with(dir);
    match root {
        Some(r) => plain(r) && holds(r),
        None => from.ancestors().skip(1).any(holds),
    }
}

/// SI projects (Chem SI Assistant's folders): move a file or folder, such as a deleted compound
/// into the project's trash folder. Never writes over anything: `to` must not be there yet. Both
/// must be inside the same project folder: nothing is ever moved into or out of a project here.
#[tauri::command]
pub fn si_move(from: String, to: String, root: Option<String>) -> Result<(), String> {
    let (f, t) = (PathBuf::from(&from), PathBuf::from(&to));
    if !in_one_project(&f, &t, root.as_deref().map(Path::new)) {
        return Err(format!("{from} was not moved: it and {to} are not both inside one SI project's folder."));
    }
    if !f.exists() {
        return Err(format!("{from} is not there (it may have been moved or deleted)."));
    }
    // (symlink_metadata: a link that points nowhere is still something in the way)
    if t.symlink_metadata().is_ok() {
        return Err(format!("{to} is already there."));
    }
    if let Some(parent) = t.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Could not make the folder {}: {e}", parent.display()))?;
    }
    rename_retrying(&f, &t).map_err(|e| format!("Could not move {from}: {e}"))
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
/// in the Trash window), by name, each marked as a folder or not, with its size in bytes and
/// when it was last changed (milliseconds since 1970; 0 when not known), so a file need not be
/// read to know whether it changed or is too large.
#[tauri::command]
pub fn si_list_dir(path: String) -> Result<serde_json::Value, String> {
    let dir = PathBuf::from(&path);
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("Could not read the folder {path}: {e}"))?;
    let mut out = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let folder = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let meta = std::fs::metadata(e.path()).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(serde_json::json!({ "name": name, "folder": folder, "size": size, "modified": modified }));
    }
    Ok(serde_json::Value::Array(out))
}

/// Whether `p` is an SI project's trash folder, or one entry directly inside it, or Chemweave's
/// undo holding folder (build/chemweave-undo) or one entry inside that (a project folder is one
/// with a project.json).
fn is_si_trash(p: &Path) -> bool {
    let named = |x: &Path, n: &str| x.file_name().and_then(|f| f.to_str()) == Some(n);
    let project = |x: Option<&Path>| x.is_some_and(|d| d.join("project.json").is_file());
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::CurDir)) {
        return false;
    }
    let trash = |x: &Path| named(x, "trash") && project(x.parent());
    let holding = |x: &Path| named(x, "chemweave-undo") && x.parent().is_some_and(|b| named(b, "build") && project(b.parent()));
    trash(p) || holding(p) || p.parent().is_some_and(|t| trash(t) || holding(t))
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
    fn says_so_when_the_listing_was_cut_short() {
        let root = std::env::temp_dir().join(format!("ci-list-cut-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        // a/b/c/deep.cdxml sits three folders down; top.cdxml at the top
        let deep = root.join("a").join("b").join("c");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(root.join("top.cdxml"), "x").unwrap();
        std::fs::write(deep.join("deep.cdxml"), "x").unwrap();
        let exts = vec!["cdxml".to_string()];
        // deep enough: whole
        let mut w = Walk::new(&exts, true);
        w.max_depth = 3;
        w.run(&root, 0);
        assert_eq!(w.out.len(), 2);
        assert!(w.complete);
        // one level too shallow: the folder below the limit is skipped, and the list says so
        let mut w = Walk::new(&exts, true);
        w.max_depth = 2;
        w.run(&root, 0);
        assert_eq!(w.out.len(), 1);
        assert!(!w.complete);
        // a folder with no folders below the limit is still whole
        let mut w = Walk::new(&exts, true);
        w.max_depth = 0;
        w.run(&deep, 0);
        assert_eq!(w.out.len(), 1);
        assert!(w.complete);
        // too many entries looked at (none of them wanted): stops, and says so
        let busy = root.join("busy");
        std::fs::create_dir_all(&busy).unwrap();
        for i in 0..20 {
            std::fs::write(busy.join(format!("n{i}.txt")), "x").unwrap();
        }
        let mut w = Walk::new(&exts, true);
        w.max_seen = 10;
        w.run(&busy, 0);
        assert!(!w.complete);
        // too many wanted files: stops, and says so
        let mut w = Walk::new(&exts, true);
        w.max_files = 1;
        w.run(&root, 0);
        assert_eq!(w.out.len(), 1);
        assert!(!w.complete);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn moves_stay_inside_one_project() {
        let root = std::env::temp_dir().join(format!("ci-si-move-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("ci-si-move-out-{}", std::process::id()));
        std::fs::create_dir_all(root.join("sections").join("a")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(root.join("sections").join("a").join("x.txt"), "x").unwrap();
        std::fs::write(outside.join("thesis.docx"), "t").unwrap();
        let s = |p: PathBuf| p.to_string_lossy().into_owned();
        let from = root.join("sections").join("a").join("x.txt");
        let to = root.join("trash").join("e").join("x.txt");
        assert!(si_move(s(from.clone()), s(to.clone()), Some(s(root.clone()))).is_err()); // no project.json yet
        std::fs::write(root.join("project.json"), "{}").unwrap();
        // a file outside the project never moves in, by ".." or by its own path
        let sneaky = root.join("sections").join("a").join("..").join("..").join("..").join(outside.file_name().unwrap()).join("thesis.docx");
        assert!(si_move(s(sneaky), s(root.join("trash").join("e").join("thesis.docx")), Some(s(root.clone()))).is_err());
        assert!(si_move(s(outside.join("thesis.docx")), s(root.join("trash").join("thesis.docx")), None).is_err());
        assert!(si_move(s(from.clone()), s(outside.join("x.txt")), Some(s(root.clone()))).is_err());
        assert!(outside.join("thesis.docx").exists() && from.exists());
        si_move(s(from.clone()), s(to.clone()), Some(s(root.clone()))).unwrap();
        assert!(to.exists() && !from.exists());
        si_move(s(to.clone()), s(from.clone()), None).unwrap(); // (an older page that names no root)
        assert!(from.exists());
        std::fs::write(&to, "y").unwrap();
        assert!(si_move(s(from.clone()), s(to), None).is_err()); // never writes over anything
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
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
        let held = root.join("build").join("chemweave-undo").join("u1");
        std::fs::create_dir_all(&held).unwrap();
        assert!(si_remove_trash(root.join("build").to_string_lossy().into_owned()).is_err());
        si_remove_trash(held.to_string_lossy().into_owned()).unwrap();
        si_remove_trash(root.join("build").join("chemweave-undo").to_string_lossy().into_owned()).unwrap();
        assert!(root.join("build").exists() && !root.join("build").join("chemweave-undo").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
