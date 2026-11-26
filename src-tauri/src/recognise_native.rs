// The structure reader run in native ONNX Runtime: the picture's encoder (the slow part, about
// 1.6 s a picture in the page's single-threaded WebAssembly, about 0.2 s here on every core) and
// the decoder's steps (src/recognise_model.rs). The page's worker hands over the picture's pixels
// and gets back the decoder's tokens, scores and hidden states; it still runs the small bond
// reader and reads the tokens itself (src/worker/recognise-worker.ts).
//
// ONNX Runtime is loaded when first needed from the copy the desktop build puts beside the app
// (ort/, fetched and checked by .github/workflows/desktop.yml), not linked into it, so a build
// without that copy, a copy that won't load, or a phone only means the page keeps reading in
// WebAssembly: recognise_native_ready says why, and nothing else changes.

/// Whether the native reader can read with this model pack: loads ONNX Runtime and the pack's
/// encoder and decoder the first time (about a second), then answers at once. An error says why not.
#[tauri::command]
pub async fn recognise_native_ready(app: tauri::AppHandle, pack: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || desktop::ready(&app, &pack))
        .await
        .map_err(|e| format!("The native reader stopped: {e}"))?
}

/// The decoder's tokens, scores and hidden states for one picture (recognise_model::Decoded::to_bytes).
/// The body is the picture's pixels (RGBA bytes, already cropped and stretched to the model's
/// square); the "pack" header names the model pack.
#[tauri::command]
pub async fn recognise_decode(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The picture was not sent as bytes.".into());
    };
    let pack = request
        .headers()
        .get("pack")
        .and_then(|v| v.to_str().ok())
        .ok_or("No model pack named.")?
        .to_string();
    let rgba = bytes.clone();
    let out = tauri::async_runtime::spawn_blocking(move || desktop::decode(&app, &pack, &rgba))
        .await
        .map_err(|e| format!("The native reader stopped: {e}"))??;
    Ok(tauri::ipc::Response::new(out))
}

/// Loads ONNX Runtime alone (no model pack needed): the self-test's proof that the copy beside
/// the app loads. An error says why not; "This copy of the app has no ..." when there is none.
#[tauri::command]
pub async fn recognise_native_runtime(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || desktop::runtime_only(&app))
        .await
        .map_err(|e| format!("The native reader stopped: {e}"))?
}

/// Lets go of the native model (after the page fell back to WebAssembly), freeing its memory.
#[tauri::command]
pub fn recognise_native_release() {
    desktop::release();
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop {
    use crate::recognise_model::Model;
    use std::path::Path;
    use std::sync::Mutex;
    use tauri::Manager;

    #[cfg(windows)]
    const LIB: &str = "onnxruntime.dll";
    #[cfg(target_os = "macos")]
    const LIB: &str = "libonnxruntime.dylib";
    #[cfg(all(unix, not(target_os = "macos")))]
    const LIB: &str = "libonnxruntime.so";

    /// ONNX Runtime, once loaded, or why it couldn't be (not tried again: the copy won't change while the app runs).
    static RUNTIME: Mutex<Option<Result<ort::environment::Environment, String>>> = Mutex::new(None);
    /// The model of the pack last used. One picture at a time: the page's worker reads one at a time anyway.
    static MODEL: Mutex<Option<(String, Model)>> = Mutex::new(None);

    fn runtime(app: &tauri::AppHandle) -> Result<ort::environment::Environment, String> {
        let mut rt = RUNTIME.lock().map_err(|_| "The native reader failed earlier.".to_string())?;
        if rt.is_none() {
            *rt = Some(load(app));
        }
        rt.as_ref().unwrap().clone()
    }

    fn load(app: &tauri::AppHandle) -> Result<ort::environment::Environment, String> {
        let dir = app.path().resource_dir().map_err(|e| format!("No resource folder: {e}"))?;
        load_from(&dir.join("ort"))
    }

    /// ONNX Runtime from the folder `ort` (the library, and on Windows the C++ runtime it needs beside it).
    pub(super) fn load_from(ort: &Path) -> Result<ort::environment::Environment, String> {
        let lib = ort.join(LIB);
        if !lib.is_file() {
            return Err(format!("This copy of the app has no {} (in {}).", LIB, lib.display()));
        }
        with_dll_folder(ort, || ort::init_from(&lib))
            .map_err(|e| format!("ONNX Runtime ({}) could not be loaded: {e}", lib.display()))?
            .with_name("chemweave-reader")
            .build()
            .map_err(|e| format!("ONNX Runtime could not start: {e}"))
    }

    /// On Windows, the library's own dependencies (the Visual C++ runtime, shipped in ort/ beside
    /// it, as a computer may not have it installed) are looked for in its folder while it loads.
    #[cfg(windows)]
    fn with_dll_folder<T>(dir: &Path, f: impl FnOnce() -> T) -> T {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::LibraryLoader::SetDllDirectoryW;
        let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: a NUL-terminated wide string that lives across the call; null restores the default search
        unsafe { SetDllDirectoryW(wide.as_ptr()) };
        let r = f();
        unsafe { SetDllDirectoryW(std::ptr::null()) };
        r
    }

    #[cfg(not(windows))]
    fn with_dll_folder<T>(_: &Path, f: impl FnOnce() -> T) -> T {
        f()
    }

    pub fn runtime_only(app: &tauri::AppHandle) -> Result<(), String> {
        runtime(app).map(|_| ())
    }

    pub fn release() {
        if let Ok(mut slot) = MODEL.lock() {
            *slot = None;
        }
    }

    /// The pack's model, loaded when the pack changes (or the first time).
    fn with_model<T>(app: &tauri::AppHandle, pack: &str, f: impl FnOnce(&mut Model) -> Result<T, String>) -> Result<T, String> {
        let env = runtime(app)?;
        let mut slot = MODEL.lock().map_err(|_| "The native reader failed earlier.".to_string())?;
        if slot.as_ref().map_or(true, |(p, _)| p != pack) {
            *slot = None;
            let model = Model::load(&env, &crate::recognise::pack_folder(app, pack)?)?;
            *slot = Some((pack.to_string(), model));
        }
        f(&mut slot.as_mut().unwrap().1)
    }

    pub fn ready(app: &tauri::AppHandle, pack: &str) -> Result<(), String> {
        with_model(app, pack, |_| Ok(()))
    }

    pub fn decode(app: &tauri::AppHandle, pack: &str, rgba: &[u8]) -> Result<Vec<u8>, String> {
        with_model(app, pack, |model| Ok(model.decode(rgba)?.to_bytes()))
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
mod desktop {
    const WHY: &str = "The native reader is only in the desktop app.";
    pub fn ready(_: &tauri::AppHandle, _: &str) -> Result<(), String> {
        Err(WHY.into())
    }
    pub fn decode(_: &tauri::AppHandle, _: &str, _: &[u8]) -> Result<Vec<u8>, String> {
        Err(WHY.into())
    }
    pub fn runtime_only(_: &tauri::AppHandle) -> Result<(), String> {
        Err(WHY.into())
    }
    pub fn release() {}
}

#[cfg(test)]
mod tests {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn a_missing_library_is_said_plainly() {
        let dir = std::env::temp_dir().join("chemweave-no-ort-here");
        let e = super::desktop::load_from(&dir).err().expect("there is no library there");
        assert!(e.starts_with("This copy of the app has no"), "{e}");
    }
}
