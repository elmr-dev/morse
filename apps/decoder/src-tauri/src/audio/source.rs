// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The `AudioSource` seam: a pull-based stream of mono PCM samples.
//!
//! Everything downstream (DSP, then the model) consumes samples through this
//! trait, never from a concrete capture path. A file is the first implementation
//! (see [`crate::audio::WavFileSource`]); live microphone capture plugs in later
//! as a second implementation without touching the consumers — that decoupling
//! is the whole point of the seam (`apps/decoder/CLAUDE.md`: "Audio source is a
//! swappable input behind a trait").
//!
//! ## Sample contract
//!
//! A source yields **mono `f32` samples normalized to `[-1.0, 1.0]`** at a fixed
//! [`sample_rate`](AudioSource::sample_rate). The suite's DSP operates on 8 kHz
//! mono audio (`packages/ml/model/data/dsp.py`: `DSP_SAMPLE_RATE = 8000`); a
//! source reports its own native rate and does *not* resample — matching the
//! DSP's expected rate is a later, conformance-locked concern, not this seam's.

use std::fmt;

/// A pull-based source of mono PCM samples.
///
/// Read semantics mirror [`std::io::Read`]: [`read`](AudioSource::read) fills the
/// caller's buffer and returns how many samples were written. A return of `0`
/// signals end-of-stream for a finite source (a file that has drained). A live
/// source (microphone) instead blocks until samples are available and never
/// reports `0`, so the same loop drives both.
pub trait AudioSource {
    /// Sample rate, in Hz, of the PCM this source produces.
    fn sample_rate(&self) -> u32;

    /// Pull the next samples into `out`, returning the count written.
    ///
    /// Writes at most `out.len()` samples. A return of `0` means a finite source
    /// is exhausted; any short read (`0 < n < out.len()`) is valid and does not
    /// imply end-of-stream.
    fn read(&mut self, out: &mut [f32]) -> Result<usize, AudioError>;

    /// Drain a *finite* source fully into one `Vec`.
    ///
    /// Convenience for batch consumers (file/clip input, tests): repeatedly
    /// [`read`](AudioSource::read)s until end-of-stream. Do **not** call this on
    /// an unbounded live source — it would never return.
    fn read_to_end(&mut self) -> Result<Vec<f32>, AudioError> {
        let mut all = Vec::new();
        let mut buf = [0.0f32; 8192];
        loop {
            let n = self.read(&mut buf)?;
            if n == 0 {
                break;
            }
            all.extend_from_slice(&buf[..n]);
        }
        Ok(all)
    }
}

/// Anything that can go wrong while opening or reading an [`AudioSource`].
///
/// Carries no `serde` derive on purpose: the domain type stays dependency-light,
/// and the Tauri boundary stringifies it (`.map_err(|e| e.to_string())`) for the
/// frontend.
#[derive(Debug)]
pub enum AudioError {
    /// Filesystem / underlying I/O failure.
    Io(std::io::Error),
    /// The container/codec is readable but not one we support.
    UnsupportedFormat(String),
    /// The bytes are malformed for their declared format.
    Decode(String),
}

impl fmt::Display for AudioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AudioError::Io(e) => write!(f, "audio I/O error: {e}"),
            AudioError::UnsupportedFormat(m) => write!(f, "unsupported audio format: {m}"),
            AudioError::Decode(m) => write!(f, "audio decode error: {m}"),
        }
    }
}

impl std::error::Error for AudioError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            AudioError::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for AudioError {
    fn from(e: std::io::Error) -> Self {
        AudioError::Io(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal in-memory source for exercising the trait's provided methods
    /// without any file or device. Hands out a fixed sample buffer in chunks.
    struct VecSource {
        rate: u32,
        samples: Vec<f32>,
        pos: usize,
    }

    impl AudioSource for VecSource {
        fn sample_rate(&self) -> u32 {
            self.rate
        }

        fn read(&mut self, out: &mut [f32]) -> Result<usize, AudioError> {
            let n = (self.samples.len() - self.pos).min(out.len());
            out[..n].copy_from_slice(&self.samples[self.pos..self.pos + n]);
            self.pos += n;
            Ok(n)
        }
    }

    #[test]
    fn read_to_end_concatenates_every_chunk() {
        // More samples than the internal 8192 read buffer, so read_to_end must
        // loop across several reads and stitch them back in order.
        let samples: Vec<f32> = (0..20_000).map(|i| (i % 7) as f32 * 0.1).collect();
        let mut src = VecSource {
            rate: 8000,
            samples: samples.clone(),
            pos: 0,
        };
        assert_eq!(src.read_to_end().unwrap(), samples);
    }

    #[test]
    fn read_reports_zero_at_end_of_stream() {
        let mut src = VecSource {
            rate: 8000,
            samples: vec![0.1, 0.2, 0.3],
            pos: 0,
        };
        let mut buf = [0.0f32; 4];
        assert_eq!(src.read(&mut buf).unwrap(), 3);
        assert_eq!(buf[..3], [0.1, 0.2, 0.3]);
        // Drained: every subsequent read is a clean zero, never an error.
        assert_eq!(src.read(&mut buf).unwrap(), 0);
        assert_eq!(src.read(&mut buf).unwrap(), 0);
    }

    #[test]
    fn read_to_end_on_empty_source_is_empty() {
        let mut src = VecSource {
            rate: 8000,
            samples: vec![],
            pos: 0,
        };
        assert!(src.read_to_end().unwrap().is_empty());
    }
}
