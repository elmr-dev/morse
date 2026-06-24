// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Greedy CTC decode — the Rust mirror of `apps/web/src/inference/decode.ts`.
//!
//! Argmax per time step, with an entropy gate that blanks low-confidence frames
//! and a blank-ratio gate that rejects all-noise windows, then a run-length
//! filter and the standard CTC collapse (drop repeats, strip blanks).
//!
//! Word-gap spaces come from `word_gap_frames`, a per-output-frame boolean mask
//! produced by `pipeline::detect_word_gap_frames` from the DSP envelope. We do
//! NOT infer them from CTC blank-run lengths: CTC models fire their labels at
//! unpredictable points inside a character's duration, so `blank_before` values
//! carry no reliable timing signal — intra-word and inter-word blanks are
//! completely interleaved in practice.

/// CTC blank label index.
pub const BLANK_IDX: usize = 0;
/// The model's output alphabet (label 1..=41); label 0 is the CTC blank.
pub const CHARS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?=/";
/// Total classes: alphabet + blank = 42.
pub const NUM_CLASSES: usize = CHARS.len() + 1;

/// A single decoded character and its per-emission model confidence.
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
///
/// `word_gap_frames` is an optional per-output-frame boolean mask produced by
/// [`pipeline::detect_word_gap_frames`]. A `true` entry means that output frame
/// lies within an audio silence long enough to be an inter-word gap; a space is
/// inserted before any character emission whose preceding blank span contains a
/// `true` frame. Pass `None` to suppress all word-gap spaces (e.g. in unit tests
/// that use synthetic log-probs without real audio).
pub fn greedy_decode(
    log_probs: &[f32],
    t: usize,
    opts: DecodeOptions,
    word_gap_frames: Option<&[bool]>,
) -> DecodeResult {
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

    // --- Collect non-blank emission runs ---
    //
    // Each run = one CTC character emission. We record frame and run_len so we
    // can check whether the silent span between consecutive emissions overlaps a
    // word-gap region in word_gap_frames.
    struct EmissionRun {
        label: usize,
        frame: usize,
        run_len: usize,
    }

    let mut runs: Vec<EmissionRun> = Vec::new();
    let mut i = 0;
    while i < t {
        let cls = filtered[i];
        let mut j = i + 1;
        while j < t && filtered[j] == cls {
            j += 1;
        }
        if cls != BLANK_IDX {
            runs.push(EmissionRun {
                label: cls,
                frame: i,
                run_len: j - i,
            });
        }
        i = j;
    }

    // --- CTC collapse + word-gap space insertion ---
    //
    // Standard CTC: same label separated by a blank gap = new emission.
    // A space is inserted before emission[i] if any output frame in the silent
    // span [prev.frame + prev.run_len .. run.frame) is marked true in
    // word_gap_frames — i.e. lies within an audio silence long enough to be a
    // word boundary.
    let mut chars: Vec<CharResult> = Vec::new();

    for (i, run) in runs.iter().enumerate() {
        if i > 0 {
            let prev = &runs[i - 1];
            let gap_start = prev.frame + prev.run_len;
            let in_word_gap = word_gap_frames.map_or(false, |wgf| {
                (gap_start..run.frame).any(|f| wgf.get(f).copied().unwrap_or(false))
            });
            if in_word_gap {
                chars.push(CharResult { ch: ' ', confidence: 1.0 });
            }
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
        let h = 8;
        let e = 5;
        let l = 12;
        let o = 15;
        let labels = [h, h, BLANK_IDX, e, BLANK_IDX, l, l, BLANK_IDX, l, o];
        let lp = one_hot_log_probs(&labels);
        let res = greedy_decode(&lp, labels.len(), DecodeOptions::default(), None);
        assert_eq!(res.text, "HELLO");
        assert!(res.confidence > 0.99);
        let non_space: Vec<_> = res.chars.iter().filter(|c| c.ch != ' ').collect();
        assert_eq!(non_space.len(), 5);
        assert!(non_space.iter().all(|c| c.confidence > 0.99));
    }

    #[test]
    fn inserts_space_at_word_gap() {
        // "HE HE": the 30-frame blank between the two words is marked as a word gap.
        // Labels: [h*2, blank*3, e*2, blank*30, h*2, blank*3, e*2]
        // The second H is at frame 37; the word gap spans frames 7..37.
        let h = 8;
        let e = 5;
        let mut labels = Vec::new();
        labels.extend(vec![h; 2]); // 0-1
        labels.extend(vec![BLANK_IDX; 3]); // 2-4
        labels.extend(vec![e; 2]); // 5-6
        labels.extend(vec![BLANK_IDX; 30]); // 7-36  ← word gap
        labels.extend(vec![h; 2]); // 37-38
        labels.extend(vec![BLANK_IDX; 3]); // 39-41
        labels.extend(vec![e; 2]); // 42-43
        let lp = one_hot_log_probs(&labels);

        let mut wgf = vec![false; labels.len()];
        for i in 7..37 { wgf[i] = true; } // mark the 30-frame silence as a word gap
        let res = greedy_decode(&lp, labels.len(), DecodeOptions::default(), Some(&wgf));
        assert_eq!(res.text, "HE HE");
        let space_idx = res.chars.iter().position(|c| c.ch == ' ').expect("no space");
        assert_eq!(res.chars[space_idx].confidence, 1.0);
        assert_eq!(res.chars.iter().filter(|c| c.ch == ' ').count(), 1);
    }

    #[test]
    fn no_space_at_inter_character_gap() {
        // "HEL" with no word_gap_frames → no spaces regardless of blank lengths.
        let h = 8;
        let e = 5;
        let l = 12;
        let mut labels = Vec::new();
        labels.extend(vec![h; 2]);
        labels.extend(vec![BLANK_IDX; 5]);
        labels.extend(vec![e; 2]);
        labels.extend(vec![BLANK_IDX; 5]);
        labels.extend(vec![l; 2]);
        let lp = one_hot_log_probs(&labels);
        let res = greedy_decode(&lp, labels.len(), DecodeOptions::default(), None);
        assert_eq!(res.text, "HEL");
        assert!(!res.text.contains(' '));
    }

    #[test]
    fn all_blank_returns_empty() {
        let labels = [BLANK_IDX; 10];
        let lp = one_hot_log_probs(&labels);
        let res = greedy_decode(&lp, labels.len(), DecodeOptions::default(), None);
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
