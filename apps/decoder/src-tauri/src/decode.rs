// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Greedy CTC decode — the Rust mirror of `apps/web/src/inference/decode.ts`
//! (`greedy_decode_with_confidence` in `packages/ml/model/eval/decode.py`).
//!
//! Argmax per time step, with an entropy gate that blanks low-confidence frames
//! and a blank-ratio gate that rejects all-noise windows, then a run-length
//! filter and the standard CTC collapse (drop repeats, strip blanks).
//!
//! Word-gap spaces are inferred post-CTC from blank-frame run lengths: a gap
//! longer than ~5× the estimated dit duration is classified as an inter-word
//! gap and a space is inserted. No model change required — the timing is
//! already encoded in the blank frame sequences.

/// CTC blank label index.
pub const BLANK_IDX: usize = 0;
/// The model's output alphabet (label 1..=41); label 0 is the CTC blank.
pub const CHARS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?=/";
/// Total classes: alphabet + blank = 42.
pub const NUM_CLASSES: usize = CHARS.len() + 1;

/// Word-gap threshold as a multiple of the estimated dit duration.
///
/// CW timing: inter-character gap ≈ 3 dits, inter-word gap ≈ 7 dits.
/// A threshold of 5 dits sits cleanly between the two; classifying a gap
/// as a word gap when blank_frames ≥ 5 × dit_frames.
const WORD_GAP_DITS: f32 = 5.0;

/// Minimum dit-frame estimate, in model output frames.
///
/// Guards against pathologically short run lengths driving the dit estimate
/// to near-zero, which would collapse all inter-character gaps into spaces.
const MIN_DIT_FRAMES: usize = 2;

/// A single decoded character and its per-emission confidence.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CharResult {
    /// The decoded character. `' '` marks an inferred inter-word gap and always
    /// carries `confidence = 1.0` (it is structural, not a model prediction).
    pub ch: char,
    /// `exp(max_log_prob)` at the emission frame; 1.0 for inferred spaces.
    pub confidence: f32,
}

/// Result of a greedy decode: collapsed text with word-gap spaces,
/// per-character confidence, and the CW tone the DSP used.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeResult {
    /// Per-character results, including inferred word-gap spaces (confidence=1.0).
    pub chars: Vec<CharResult>,
    /// Full decoded text — `chars` joined; spaces are inter-word gaps.
    pub text: String,
    /// Mean `exp(max_log_prob)` over emitted (non-space) labels; 0.0 when empty.
    pub confidence: f32,
    /// CW tone the DSP bandpass and matched filters were centred on, in Hz.
    /// Set by [`pipeline::decode_samples`]; 0.0 until then.
    pub detected_tone_hz: f64,
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

/// Map a label index to its character (returns `None` for blank or out-of-range).
fn idx_to_char(idx: usize) -> Option<char> {
    if idx == BLANK_IDX || idx > CHARS.len() {
        return None;
    }
    // CHARS is ASCII, so byte-indexing is char-indexing.
    CHARS[idx - 1..idx].chars().next()
}

/// Greedy CTC decode of flat `(T, NUM_CLASSES)` log-probabilities.
pub fn greedy_decode(log_probs: &[f32], t: usize, opts: DecodeOptions) -> DecodeResult {
    let c = NUM_CLASSES;
    let log_num_classes = (NUM_CLASSES as f32).ln();

    // --- Argmax + entropy gate ---
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

    // --- Blank ratio gate ---
    let non_blank = argmax.iter().filter(|&&a| a != BLANK_IDX).count();
    if non_blank < 2 || (non_blank as f32) / (t as f32) < 1.0 - opts.blank_ratio_threshold {
        return DecodeResult {
            chars: Vec::new(),
            text: String::new(),
            confidence: 0.0,
            detected_tone_hz: 0.0,
        };
    }

    // --- Run-length filter: short non-blank runs are demoted to blank ---
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

    // --- Collect non-blank emission runs with their preceding blank lengths ---
    //
    // Each run = one CTC emission (a new character). Blank runs are not emitted
    // but their lengths are tracked for word-gap detection.
    struct EmissionRun {
        label: usize,
        /// First frame index of this run — used to look up per-emission confidence.
        frame: usize,
        run_len: usize,
        /// Total blank frames immediately preceding this run.
        blank_before: usize,
    }

    let mut runs: Vec<EmissionRun> = Vec::new();
    let mut pending_blanks = 0usize;
    let mut i = 0;
    while i < t {
        let cls = filtered[i];
        let mut j = i + 1;
        while j < t && filtered[j] == cls {
            j += 1;
        }
        let run_len = j - i;
        if cls == BLANK_IDX {
            pending_blanks += run_len;
        } else {
            runs.push(EmissionRun {
                label: cls,
                frame: i,
                run_len,
                blank_before: pending_blanks,
            });
            pending_blanks = 0;
        }
        i = j;
    }

    // --- Estimate dit duration from the shortest non-blank run ---
    //
    // The shortest emitted run approximates one dit at the sender's speed.
    // Floored at MIN_DIT_FRAMES to prevent the word-gap threshold collapsing
    // to near-zero on unusually short noise runs.
    let dit_frames = runs
        .iter()
        .map(|r| r.run_len)
        .min()
        .unwrap_or(MIN_DIT_FRAMES)
        .max(MIN_DIT_FRAMES) as f32;

    let word_gap_threshold = WORD_GAP_DITS * dit_frames;

    // --- CTC collapse + word-gap space insertion ---
    //
    // Every entry in `runs` is a distinct character emission (standard CTC:
    // same label after a blank gap IS a new emission). A space is inserted
    // before an emission whose preceding blank run exceeds the word-gap threshold.
    let mut chars: Vec<CharResult> = Vec::new();

    for (i, run) in runs.iter().enumerate() {
        if i > 0 && run.blank_before as f32 >= word_gap_threshold {
            chars.push(CharResult {
                ch: ' ',
                confidence: 1.0,
            });
        }
        if let Some(ch) = idx_to_char(run.label) {
            chars.push(CharResult {
                ch,
                confidence: max_lp[run.frame].exp(),
            });
        }
    }

    let non_space: Vec<f32> = chars
        .iter()
        .filter(|c| c.ch != ' ')
        .map(|c| c.confidence)
        .collect();

    let confidence = if non_space.is_empty() {
        0.0
    } else {
        non_space.iter().sum::<f32>() / non_space.len() as f32
    };

    let text: String = chars.iter().map(|c| c.ch).collect();

    DecodeResult {
        chars,
        text,
        confidence,
        detected_tone_hz: 0.0, // filled in by pipeline::decode_samples
    }
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
        // labels: H H _ E _ L L _ L O  (1-indexed: H=8, E=5, L=12, O=15)
        // Gaps between emissions are 1 blank frame each — well below the word-gap
        // threshold — so no spaces are inserted and the result is "HELLO".
        let h = 8;
        let e = 5;
        let l = 12;
        let o = 15;
        let labels = [h, h, BLANK_IDX, e, BLANK_IDX, l, l, BLANK_IDX, l, o];
        let lp = one_hot_log_probs(&labels);
        let res = greedy_decode(&lp, labels.len(), DecodeOptions::default());
        assert_eq!(res.text, "HELLO");
        assert!(res.confidence > 0.99);
        // Per-character confidence: 5 chars (H E L L O), all 1.0 from one-hot.
        let non_space: Vec<_> = res.chars.iter().filter(|c| c.ch != ' ').collect();
        assert_eq!(non_space.len(), 5);
        assert!(non_space.iter().all(|c| c.confidence > 0.99));
    }

    #[test]
    fn inserts_space_at_word_gap() {
        // Two H's separated by a long blank run (50 frames) → space between them.
        // dit_frames = min_run_len.max(MIN_DIT_FRAMES) = 2.max(2) = 2
        // word_gap_threshold = 5 * 2 = 10; blank_before = 50 ≥ 10 → space.
        let h = 8;
        let mut labels = vec![h; 2];
        labels.extend(vec![BLANK_IDX; 50]);
        labels.extend(vec![h; 2]);
        let lp = one_hot_log_probs(&labels);
        let res = greedy_decode(&lp, labels.len(), DecodeOptions::default());
        assert_eq!(res.text, "H H");
        assert_eq!(res.chars.len(), 3); // H space H
        assert_eq!(res.chars[1].ch, ' ');
        assert_eq!(res.chars[1].confidence, 1.0);
    }

    #[test]
    fn no_space_at_inter_character_gap() {
        // Two distinct characters separated by 3 blank frames (inter-char gap).
        // dit_frames = 2, threshold = 10; 3 < 10 → no space.
        let h = 8;
        let e = 5;
        let labels = [h, h, BLANK_IDX, BLANK_IDX, BLANK_IDX, e, e];
        let lp = one_hot_log_probs(&labels);
        let res = greedy_decode(&lp, labels.len(), DecodeOptions::default());
        assert_eq!(res.text, "HE");
        assert!(!res.text.contains(' '));
    }

    #[test]
    fn all_blank_returns_empty() {
        let labels = [BLANK_IDX; 10];
        let lp = one_hot_log_probs(&labels);
        let res = greedy_decode(&lp, labels.len(), DecodeOptions::default());
        assert_eq!(res.text, "");
        assert_eq!(res.confidence, 0.0);
        assert!(res.chars.is_empty());
    }

    #[test]
    fn idx_to_char_covers_alphabet_edges() {
        assert_eq!(idx_to_char(BLANK_IDX), None);
        assert_eq!(idx_to_char(1), Some('A'));
        assert_eq!(idx_to_char(26), Some('Z'));
        assert_eq!(idx_to_char(27), Some('0'));
        assert_eq!(idx_to_char(CHARS.len()), Some('/'));
        assert_eq!(idx_to_char(CHARS.len() + 1), None);
    }
}
