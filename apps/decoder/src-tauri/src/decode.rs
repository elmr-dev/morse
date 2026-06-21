// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Greedy CTC decode — the Rust mirror of `apps/web/src/inference/decode.ts`
//! (`greedy_decode_with_confidence` in `packages/ml/model/eval/decode.py`).
//!
//! Argmax per time step, with an entropy gate that blanks low-confidence frames
//! and a blank-ratio gate that rejects all-noise windows, then a run-length
//! filter and the standard CTC collapse (drop repeats, strip blanks).

/// CTC blank label index.
pub const BLANK_IDX: usize = 0;
/// The model's output alphabet (label 1..=41); label 0 is the CTC blank.
pub const CHARS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?=/";
/// Total classes: alphabet + blank = 42.
pub const NUM_CLASSES: usize = CHARS.len() + 1;

/// Result of a greedy decode: collapsed text plus mean per-emission confidence.
#[derive(Debug, Clone)]
pub struct DecodeResult {
    /// Decoded characters with CTC repeats/blanks collapsed (no inter-word spaces;
    /// the alphabet has no space label).
    pub text: String,
    /// Mean `exp(max_log_prob)` over emitted labels, in `[0, 1]`; 0 when empty.
    pub confidence: f32,
}

/// Tunables for the gates; defaults match decode.ts (`greedyDecode`).
#[derive(Debug, Clone, Copy)]
pub struct DecodeOptions {
    /// Frames below this normalized-confidence are forced to blank (0 disables).
    pub entropy_threshold: f32,
    /// Reject the window if the non-blank fraction is below `1 - this`.
    pub blank_ratio_threshold: f32,
    /// Runs of a non-blank label shorter than this are forced to blank.
    pub min_run_length: usize,
}

impl Default for DecodeOptions {
    fn default() -> Self {
        Self {
            entropy_threshold: 0.3,
            blank_ratio_threshold: 0.999,
            min_run_length: 1,
        }
    }
}

/// Map a label index to its character (`0` → empty blank).
fn idx_to_char(idx: usize) -> &'static str {
    if idx == BLANK_IDX || idx > CHARS.len() {
        return "";
    }
    // CHARS is ASCII, so byte-indexing is char-indexing.
    &CHARS[idx - 1..idx]
}

/// Greedy CTC decode of flat `(T, NUM_CLASSES)` log-probabilities.
pub fn greedy_decode(log_probs: &[f32], t: usize, opts: DecodeOptions) -> DecodeResult {
    let c = NUM_CLASSES;
    let log_num_classes = (NUM_CLASSES as f32).ln();

    let mut argmax = vec![0usize; t];
    let mut max_lp = vec![f32::NEG_INFINITY; t];

    for ti in 0..t {
        let row = &log_probs[ti * c..ti * c + c];
        let mut best = 0usize;
        let mut best_lp = f32::NEG_INFINITY;
        for (ci, &v) in row.iter().enumerate() {
            if v > best_lp {
                best_lp = v;
                best = ci;
            }
        }
        argmax[ti] = best;
        max_lp[ti] = best_lp;

        if opts.entropy_threshold > 0.0 {
            let mut h = 0.0f32;
            for &lp in row {
                let p = lp.exp();
                if p > 0.0 {
                    h -= p * lp;
                }
            }
            let conf = 1.0 - h / log_num_classes;
            if conf < opts.entropy_threshold {
                argmax[ti] = BLANK_IDX;
            }
        }
    }

    let non_blank = argmax.iter().filter(|&&a| a != BLANK_IDX).count();
    if non_blank < 2 || (non_blank as f32) / (t as f32) < 1.0 - opts.blank_ratio_threshold {
        return DecodeResult {
            text: String::new(),
            confidence: 0.0,
        };
    }

    // Run-length filter: short non-blank runs are demoted to blank.
    let mut filtered = vec![0usize; t];
    let mut i = 0;
    while i < t {
        let cls = argmax[i];
        let mut j = i + 1;
        while j < t && argmax[j] == cls {
            j += 1;
        }
        let run_len = j - i;
        let keep = cls == BLANK_IDX || run_len >= opts.min_run_length;
        for f in filtered.iter_mut().take(j).skip(i) {
            *f = if keep { cls } else { BLANK_IDX };
        }
        i = j;
    }

    // CTC collapse: emit on label change, skipping blanks.
    let mut text = String::new();
    let mut confs: Vec<f32> = Vec::new();
    let mut prev: isize = -1;
    for ti in 0..t {
        let idx = filtered[ti];
        if idx as isize != prev {
            if idx != BLANK_IDX {
                text.push_str(idx_to_char(idx));
                confs.push(max_lp[ti].exp());
            }
            prev = idx as isize;
        }
    }

    let confidence = if confs.is_empty() {
        0.0
    } else {
        confs.iter().sum::<f32>() / confs.len() as f32
    };
    DecodeResult { text, confidence }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build flat log-probs that put all mass on `labels[t]` per step (others ~0).
    fn one_hot_log_probs(labels: &[usize]) -> Vec<f32> {
        let mut lp = vec![-50.0f32; labels.len() * NUM_CLASSES];
        for (t, &l) in labels.iter().enumerate() {
            lp[t * NUM_CLASSES + l] = 0.0; // log(1) = 0 → fully confident
        }
        lp
    }

    #[test]
    fn collapses_repeats_and_strips_blanks() {
        // labels: H H _ E _ L L _ L O  (1-indexed into CHARS: H=8,E=5,L=12,O=15)
        let h = 8;
        let e = 5;
        let l = 12;
        let o = 15;
        let labels = [h, h, BLANK_IDX, e, BLANK_IDX, l, l, BLANK_IDX, l, o];
        let lp = one_hot_log_probs(&labels);
        let res = greedy_decode(&lp, labels.len(), DecodeOptions::default());
        assert_eq!(res.text, "HELLO");
        assert!(res.confidence > 0.99);
    }

    #[test]
    fn all_blank_returns_empty() {
        let labels = [BLANK_IDX; 10];
        let lp = one_hot_log_probs(&labels);
        let res = greedy_decode(&lp, labels.len(), DecodeOptions::default());
        assert_eq!(res.text, "");
        assert_eq!(res.confidence, 0.0);
    }

    #[test]
    fn idx_to_char_covers_alphabet_edges() {
        assert_eq!(idx_to_char(BLANK_IDX), "");
        assert_eq!(idx_to_char(1), "A");
        assert_eq!(idx_to_char(26), "Z");
        assert_eq!(idx_to_char(27), "0");
        assert_eq!(idx_to_char(CHARS.len()), "/");
        assert_eq!(idx_to_char(CHARS.len() + 1), "");
    }
}
