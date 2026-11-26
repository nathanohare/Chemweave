// The structure reader's model run natively (src/recognise_native.rs calls it): the picture's
// encoder and the decoder's steps, the same greedy decoding as readStructure in
// src/recognise/molscribe.ts. The page gets back only the tokens, their scores and the decoder's
// hidden states (tens of kilobytes); the encoder's keys and values (about 1.8 MB a picture) stay
// here, as moving them to the page cost more than the encoder itself. The bond reader, which is
// tiny, and the reading of the tokens stay in the page's worker. No Tauri here, so it can be
// checked on its own.

use ort::environment::Environment;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::{DynValue, Tensor};
use std::path::Path;

/// The decoder's words and sizes, as scripts/recognition/export.py writes them (vocab.json).
#[derive(serde::Deserialize, Clone, Debug)]
pub struct Vocab {
    /// Token ids from here on are x places (maxx of them), then y places (maxy).
    pub offset: usize,
    pub maxx: usize,
    pub maxy: usize,
    #[serde(rename = "maxLen")]
    pub max_len: usize,
    pub layers: usize,
    pub heads: usize,
    pub dk: usize,
    /// The picture's side (pixels).
    pub size: usize,
}

const SOS: usize = 1;
const EOS: usize = 2;

/// What the decoder wrote: its tokens, each one's log-probability, and its hidden state after each (dim floats each).
#[derive(Debug, Default, PartialEq)]
pub struct Decoded {
    pub seq: Vec<i32>,
    pub scores: Vec<f32>,
    pub hidden: Vec<f32>,
    pub dim: usize,
}

impl Decoded {
    /// As bytes for the page: token count and hidden size (u32 each), then the tokens (i32), the
    /// scores (f32) and the hidden states (f32), all little-endian.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut b = Vec::with_capacity(8 + 8 * self.seq.len() + 4 * self.hidden.len());
        b.extend_from_slice(&(self.seq.len() as u32).to_le_bytes());
        b.extend_from_slice(&(self.dim as u32).to_le_bytes());
        for t in &self.seq {
            b.extend_from_slice(&t.to_le_bytes());
        }
        for s in &self.scores {
            b.extend_from_slice(&s.to_le_bytes());
        }
        for h in &self.hidden {
            b.extend_from_slice(&h.to_le_bytes());
        }
        b
    }
}

/// The picture as the encoder takes it (3 × size × size), from its pixels already cropped and
/// stretched to size × size (RGBA): ImageNet grey, transparent as white paper. The same sums as
/// imageTensor in molscribe.ts, in f64, so the floats are the same.
pub fn image_tensor(rgba: &[u8], size: usize) -> Result<Vec<f32>, String> {
    let n = size * size;
    if rgba.len() != n * 4 {
        return Err(format!("The picture is {} bytes, not {} × {} pixels.", rgba.len(), size, size));
    }
    const MEAN: [f64; 3] = [0.485, 0.456, 0.406];
    const STD: [f64; 3] = [0.229, 0.224, 0.225];
    let mut out = vec![0f32; 3 * n];
    for i in 0..n {
        let (r, g, b) = (rgba[i * 4] as f64, rgba[i * 4 + 1] as f64, rgba[i * 4 + 2] as f64);
        let a = rgba[i * 4 + 3] as f64 / 255.0;
        let grey = ((0.299 * r + 0.587 * g + 0.114 * b) * a + 255.0 * (1.0 - a)) / 255.0;
        for c in 0..3 {
            out[c * n + i] = ((grey - MEAN[c]) / STD[c]) as f32;
        }
    }
    Ok(out)
}

/// The decoder's next token from its log-probabilities: after an x place only a y place, after a
/// y place no place, and never the end first. Returns the token and its log-probability.
pub fn pick(logp: &[f32], tok: usize, pos: usize, v: &Vocab) -> (usize, f32) {
    let is_x = |t: usize| t >= v.offset && t < v.offset + v.maxx;
    let is_y = |t: usize| t >= v.offset + v.maxx;
    let (mut lo, mut hi) = (0, logp.len());
    if is_x(tok) {
        lo = v.offset + v.maxx;
    } else if is_y(tok) {
        hi = v.offset.min(logp.len());
    }
    let (mut best, mut best_p) = (usize::MAX, f32::NEG_INFINITY);
    for (i, &p) in logp.iter().enumerate().take(hi).skip(lo) {
        if pos == 0 && i == EOS {
            continue;
        }
        if p > best_p {
            best_p = p;
            best = i;
        }
    }
    (best, best_p)
}

/// The encoder and one decoder step of a model pack, loaded.
pub struct Model {
    pub vocab: Vocab,
    encoder: Session,
    step: Session,
}

fn session(env: &Environment, path: &Path) -> Result<Session, String> {
    if !path.is_file() {
        return Err("The structure reader isn't downloaded yet.".into());
    }
    Session::builder(env)
        .map_err(|e| e.to_string())?
        .with_optimization_level(GraphOptimizationLevel::All)
        .map_err(|e| e.to_string())?
        .commit_from_file(path)
        .map_err(|e| format!("{} could not be loaded: {e}", path.display()))
}

impl Model {
    /// The model in a pack's folder (encoder.onnx, step.onnx, vocab.json).
    pub fn load(env: &Environment, dir: &Path) -> Result<Model, String> {
        let text = std::fs::read_to_string(dir.join("vocab.json")).map_err(|e| format!("The reader's vocabulary could not be read: {e}"))?;
        let vocab: Vocab = serde_json::from_str(&text).map_err(|e| format!("The reader's vocabulary could not be read: {e}"))?;
        Ok(Model { encoder: session(env, &dir.join("encoder.onnx"))?, step: session(env, &dir.join("step.onnx"))?, vocab })
    }

    /// Read one picture (RGBA, already size × size): the encoder, then the decoder step by step.
    pub fn decode(&mut self, rgba: &[u8]) -> Result<Decoded, String> {
        let v = self.vocab.clone();
        let err = |e: ort::Error| format!("The reader failed: {e}");
        let image = image_tensor(rgba, v.size)?;
        let input = Tensor::from_array(([1usize, 3, v.size, v.size], image)).map_err(err)?;
        let (ck, cv) = {
            let mut out = self.encoder.run(ort::inputs!["image" => input]).map_err(err)?;
            (out.remove("ck").ok_or("The encoder gave no keys.")?, out.remove("cv").ok_or("The encoder gave no values.")?)
        };
        let empty = || -> Result<DynValue, String> { Ok(Tensor::from_array(([v.layers, 1, v.heads, 0, v.dk], Vec::<f32>::new())).map_err(err)?.into_dyn()) };
        let (mut pk, mut pv) = (empty()?, empty()?);
        let mut d = Decoded::default();
        let mut tok = SOS;
        for pos in 0..v.max_len {
            let token = Tensor::from_array(([1usize], vec![tok as i64])).map_err(err)?;
            let at = Tensor::from_array(((), vec![pos as i64])).map_err(err)?;
            let mut out = self
                .step
                .run(ort::inputs!["token" => token, "pos" => at, "pk" => &pk, "pv" => &pv, "ck" => &ck, "cv" => &cv])
                .map_err(err)?;
            let (best, score) = {
                let (_, logp) = out["logp"].try_extract_tensor::<f32>().map_err(err)?;
                pick(logp, tok, pos, &v)
            };
            if best == usize::MAX {
                return Err("The reader found no token to write.".into());
            }
            {
                let (_, h) = out["hidden"].try_extract_tensor::<f32>().map_err(err)?;
                d.dim = h.len();
                d.hidden.extend_from_slice(h);
            }
            let nk = out.remove("nk").ok_or("The decoder gave no keys.")?;
            let nv = out.remove("nv").ok_or("The decoder gave no values.")?;
            drop(out);
            pk = nk;
            pv = nv;
            d.seq.push(best as i32);
            d.scores.push(score);
            tok = best;
            if best == EOS {
                break;
            }
        }
        Ok(d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vocab() -> Vocab {
        // 10 words, then 4 x places, then 4 y places
        Vocab { offset: 10, maxx: 4, maxy: 4, max_len: 480, layers: 1, heads: 1, dk: 2, size: 2 }
    }

    #[test]
    fn after_a_word_any_token_but_never_the_end_first() {
        let v = vocab();
        let mut logp = vec![-9f32; 18];
        logp[EOS] = 0.0;
        logp[5] = -1.0;
        assert_eq!(pick(&logp, SOS, 0, &v), (5, -1.0));
        assert_eq!(pick(&logp, 5, 3, &v), (EOS, 0.0));
    }

    #[test]
    fn an_x_place_is_followed_by_a_y_place_and_a_y_place_by_a_word() {
        let v = vocab();
        let mut logp = vec![-9f32; 18];
        logp[3] = -0.5; // a word
        logp[11] = -0.1; // an x place
        logp[15] = -2.0; // a y place
        assert_eq!(pick(&logp, 11, 4, &v).0, 15);
        assert_eq!(pick(&logp, 15, 5, &v).0, 3);
        assert_eq!(pick(&logp, 3, 6, &v).0, 11);
    }

    #[test]
    fn the_picture_as_the_encoder_takes_it() {
        // white, black, and a see-through pixel (as white paper), and a mid grey
        let rgba = [255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0, 128, 128, 128, 255];
        let t = image_tensor(&rgba, 2).unwrap();
        assert_eq!(t.len(), 12);
        let white = ((1.0 - 0.485) / 0.229) as f32;
        assert_eq!(t[0], white);
        assert_eq!(t[1], ((0.0 - 0.485) / 0.229) as f32);
        assert_eq!(t[2], white);
        assert!((t[3] - ((128.0 / 255.0 - 0.485) / 0.229) as f32).abs() < 1e-6);
        assert_eq!(t[4], ((1.0 - 0.456) / 0.224) as f32);
        assert!(image_tensor(&rgba[..12], 2).is_err());
    }

    #[test]
    fn decoded_as_bytes() {
        let d = Decoded { seq: vec![5, 2], scores: vec![-0.5, -0.25], hidden: vec![1.0, 2.0, 3.0, 4.0], dim: 2 };
        let b = d.to_bytes();
        assert_eq!(b.len(), 8 + 2 * 4 + 2 * 4 + 4 * 4);
        assert_eq!(&b[0..4], &2u32.to_le_bytes());
        assert_eq!(&b[4..8], &2u32.to_le_bytes());
        assert_eq!(&b[8..12], &5i32.to_le_bytes());
        assert_eq!(&b[16..20], &(-0.5f32).to_le_bytes());
        assert_eq!(&b[36..40], &4f32.to_le_bytes());
    }
}
