// The structure reader's picture encoder in native ONNX Runtime. The encoder is the slow part
// of reading a structure: about 1.6 s a picture in the page's single-threaded WebAssembly, and
// about 0.2 s here on every core (Nate's laptop, the same model). The rest of the reading (the
// decoder's steps and the bond reader) stays in the page's worker (src/worker/recognise-worker.ts),
// which hands the picture over and gets the encoder's keys and values back.
//
// ONNX Runtime is loaded when first needed from the copy the desktop build puts beside the app
// (ort/, fetched and checked by .github/workflows/desktop.yml), not linked into it, so a build
// without that copy, a copy that won't load, or a phone only means the page keeps using its
// WebAssembly encoder: recognise_native_ready says why, and nothing else changes.

/// Whether the native encoder can read with this model pack: loads ONNX Runtime and the pack's
/// encoder the first time (about a second), then answers at once. An error says why not.
#[tauri::command]
pub async fn recognise_native_ready(app: tauri::AppHandle, pack: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || desktop::ready(&app, &pack))
        .await
        .map_err(|e| format!("The native reader stopped: {e}"))?
}

/// The encoder's keys and values for one picture. The body is the picture as the encoder takes
/// it (3 × size × size little-endian 32-bit floats); the "pack" header names the model pack.
/// The answer is the keys, then the values, as little-endian 32-bit floats of equal length.
#[tauri::command]
pub async fn recognise_encode(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The picture was not sent as bytes.".into());
    };
    let pack = request
        .headers()
        .get("pack")
        .and_then(|v| v.to_str().ok())
        .ok_or("No model pack named.")?
        .to_string();
    let image = floats(bytes)?;
    let out = tauri::async_runtime::spawn_blocking(move || desktop::encode(&app, &pack, image))
        .await
        .map_err(|e| format!("The native reader stopped: {e}"))??;
    Ok(tauri::ipc::Response::new(out))
}

/// Little-endian 32-bit floats from bytes; an error when they aren't a whole picture.
fn floats(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return Err("The picture's bytes are not whole numbers.".into());
    }
    let v: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    picture_side(v.len())?;
    Ok(v)
}

/// The side of the square picture `n` floats make (3 colour planes); an error when they don't.
fn picture_side(n: usize) -> Result<usize, String> {
    let side = ((n / 3) as f64).sqrt().round() as usize;
    if side == 0 || n % 3 != 0 || side * side * 3 != n {
        return Err(format!("{n} numbers are not a square picture in three colours."));
    }
    Ok(side)
}

/// The keys, then the values, as little-endian bytes.
fn to_bytes(keys: &[f32], values: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity((keys.len() + values.len()) * 4);
    for x in keys.iter().chain(values) {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop {
    use ort::session::{builder::GraphOptimizationLevel, Session};
    use ort::value::Tensor;
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
    /// The encoder of the pack last used. One picture at a time: the page's worker reads one at a time anyway.
    static ENCODER: Mutex<Option<(String, Session)>> = Mutex::new(None);

    fn runtime(app: &tauri::AppHandle) -> Result<ort::environment::Environment, String> {
        let mut rt = RUNTIME.lock().map_err(|_| "The native reader failed earlier.".to_string())?;
        if rt.is_none() {
            *rt = Some(load(app));
        }
        rt.as_ref().unwrap().clone()
    }

    fn load(app: &tauri::AppHandle) -> Result<ort::environment::Environment, String> {
        let dir = app.path().resource_dir().map_err(|e| format!("No resource folder: {e}"))?;
        let lib = dir.join("ort").join(LIB);
        if !lib.is_file() {
            return Err(format!("This copy of the app has no {} (in {}).", LIB, lib.display()));
        }
        ort::init_from(&lib)
            .map_err(|e| format!("ONNX Runtime ({}) could not be loaded: {e}", lib.display()))?
            .with_name("chemweave-reader")
            .build()
            .map_err(|e| format!("ONNX Runtime could not start: {e}"))
    }

    /// The pack's encoder, loaded when the pack changes (or the first time).
    fn with_encoder<T>(app: &tauri::AppHandle, pack: &str, f: impl FnOnce(&mut Session) -> Result<T, String>) -> Result<T, String> {
        let env = runtime(app)?;
        let mut slot = ENCODER.lock().map_err(|_| "The native reader failed earlier.".to_string())?;
        if slot.as_ref().map_or(true, |(p, _)| p != pack) {
            *slot = None;
            let path = crate::recognise::pack_folder(app, pack)?.join("encoder.onnx");
            if !path.is_file() {
                return Err("The structure reader isn't downloaded yet.".into());
            }
            let session = Session::builder(&env)
                .map_err(|e| e.to_string())?
                .with_optimization_level(GraphOptimizationLevel::Level3)
                .map_err(|e| e.to_string())?
                .commit_from_file(&path)
                .map_err(|e| format!("The encoder could not be loaded: {e}"))?;
            *slot = Some((pack.to_string(), session));
        }
        f(&mut slot.as_mut().unwrap().1)
    }

    pub fn ready(app: &tauri::AppHandle, pack: &str) -> Result<(), String> {
        with_encoder(app, pack, |_| Ok(()))
    }

    pub fn encode(app: &tauri::AppHandle, pack: &str, image: Vec<f32>) -> Result<Vec<u8>, String> {
        let side = super::picture_side(image.len())?;
        with_encoder(app, pack, |session| {
            let input = Tensor::from_array(([1usize, 3, side, side], image)).map_err(|e| e.to_string())?;
            let out = session.run(ort::inputs!["image" => input]).map_err(|e| format!("The encoder failed: {e}"))?;
            let (_, keys) = out["ck"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
            let (_, values) = out["cv"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
            Ok(super::to_bytes(keys, values))
        })
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
mod desktop {
    const WHY: &str = "The native reader is only in the desktop app.";
    pub fn ready(_: &tauri::AppHandle, _: &str) -> Result<(), String> {
        Err(WHY.into())
    }
    pub fn encode(_: &tauri::AppHandle, _: &str, _: Vec<f32>) -> Result<Vec<u8>, String> {
        Err(WHY.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_comes_through_as_floats() {
        let px = [0.5f32, -1.25, 3.0];
        let bytes: Vec<u8> = px.iter().flat_map(|x| x.to_le_bytes()).collect();
        assert_eq!(floats(&bytes).unwrap(), px);
    }

    #[test]
    fn only_square_three_colour_pictures_are_taken() {
        assert_eq!(picture_side(3 * 384 * 384), Ok(384));
        assert!(picture_side(0).is_err());
        assert!(picture_side(3 * 384 * 383).is_err());
        assert!(picture_side(384 * 384).is_err());
        assert!(floats(&[0, 0, 0]).is_err());
        assert!(floats(&[]).is_err());
    }

    #[test]
    fn keys_then_values_as_bytes() {
        let b = to_bytes(&[1.0, 2.0], &[3.0, 4.0]);
        let back: Vec<f32> = b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        assert_eq!(back, [1.0, 2.0, 3.0, 4.0]);
    }
}
