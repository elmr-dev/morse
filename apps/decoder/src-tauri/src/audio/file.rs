// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! [`WavFileSource`] — the first [`AudioSource`]: read a WAV clip from disk and
//! hand its samples to the decode path as mono `f32`.
//!
//! This is the "file first" half of Slice 2 (mdp/morse#22): prove samples cross
//! into Rust through the [`AudioSource`] seam, with no decode yet. WAV is the
//! format the suite's golden fixtures ship in (`fixtures/dsp/clips/*.input.wav`,
//! 8 kHz mono 16-bit) and what a rig recording is typically captured as.
//!
//! Decoding is eager: [`open`](WavFileSource::open) reads and normalizes the
//! whole clip up front, then [`read`](AudioSource::read) is a cursor over that
//! buffer. Clips are bounded and small, so this keeps the implementation simple
//! while still presenting the streaming pull interface a live source needs.

use std::io::{Read, Seek};
use std::path::Path;

use hound::{SampleFormat, WavReader};

use super::source::{AudioError, AudioSource};

/// A finite [`AudioSource`] backed by a decoded WAV clip.
///
/// Samples are normalized to mono `f32` in `[-1.0, 1.0]`; multi-channel files are
/// downmixed by averaging channels. The source reports the file's native sample
/// rate verbatim — it does not resample.
pub struct WavFileSource {
    sample_rate: u32,
    samples: Vec<f32>,
    pos: usize,
}

impl WavFileSource {
    /// Open and decode a WAV file at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, AudioError> {
        let reader = WavReader::open(path).map_err(map_hound)?;
        Self::from_reader(reader)
    }

    /// Decode a WAV stream from any reader.
    ///
    /// The path-free seam `open` delegates to: it keeps the decode logic in one
    /// place and lets tests build clips in memory (via [`std::io::Cursor`])
    /// without touching the filesystem.
    pub fn from_reader<R: Read + Seek>(reader: WavReader<R>) -> Result<Self, AudioError> {
        let spec = reader.spec();
        let channels = spec.channels as usize;
        if channels == 0 {
            return Err(AudioError::Decode("WAV reports zero channels".into()));
        }

        // Normalize every supported sample format to interleaved f32 in [-1, 1].
        let interleaved: Vec<f32> = match spec.sample_format {
            SampleFormat::Float => reader
                .into_samples::<f32>()
                .collect::<Result<_, _>>()
                .map_err(map_hound)?,
            SampleFormat::Int => {
                // hound widens any integer depth (8/16/24/32) to i32. Scale by
                // the format's full-scale magnitude so 16-bit and 24-bit clips
                // both land in [-1, 1].
                let scale = 1.0f32 / (1i64 << (spec.bits_per_sample - 1)) as f32;
                reader
                    .into_samples::<i32>()
                    .map(|s| s.map(|v| v as f32 * scale))
                    .collect::<Result<_, _>>()
                    .map_err(map_hound)?
            }
        };

        let samples = if channels == 1 {
            interleaved
        } else {
            // Downmix: average each frame's channels into one mono sample.
            interleaved
                .chunks(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                .collect()
        };

        Ok(Self {
            sample_rate: spec.sample_rate,
            samples,
            pos: 0,
        })
    }
}

impl AudioSource for WavFileSource {
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn read(&mut self, out: &mut [f32]) -> Result<usize, AudioError> {
        let n = (self.samples.len() - self.pos).min(out.len());
        out[..n].copy_from_slice(&self.samples[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }
}

/// Translate a `hound` error into the decoder's audio error vocabulary.
fn map_hound(e: hound::Error) -> AudioError {
    match e {
        hound::Error::IoError(io) => AudioError::Io(io),
        hound::Error::Unsupported => {
            AudioError::UnsupportedFormat("unsupported WAV feature".into())
        }
        hound::Error::FormatError(m) => AudioError::Decode(m.to_string()),
        other => AudioError::Decode(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hound::{WavSpec, WavWriter};
    use std::io::Cursor;
    use std::path::PathBuf;

    /// Build an in-memory WAV (16-bit int) and return it as a seekable reader.
    fn wav_i16(channels: u16, sample_rate: u32, samples: &[i16]) -> Cursor<Vec<u8>> {
        let spec = WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };
        let mut buf = Cursor::new(Vec::new());
        {
            let mut w = WavWriter::new(&mut buf, spec).unwrap();
            for &s in samples {
                w.write_sample(s).unwrap();
            }
            w.finalize().unwrap();
        }
        buf.set_position(0);
        buf
    }

    /// Path to a checked-in golden clip under repo-root `fixtures/dsp/clips/`.
    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/dsp/clips")
            .join(name)
    }

    #[test]
    fn decodes_mono_16bit_and_normalizes() {
        // i16::MIN/MAX map to the [-1, 1] edges; 0 stays 0.
        let reader = WavReader::new(wav_i16(1, 8000, &[0, i16::MAX, i16::MIN])).unwrap();
        let src = WavFileSource::from_reader(reader).unwrap();
        assert_eq!(src.sample_rate(), 8000);
        assert_eq!(src.samples.len(), 3);
        assert!((src.samples[0] - 0.0).abs() < 1e-6);
        assert!((src.samples[1] - 0.999_97).abs() < 1e-4);
        assert!((src.samples[2] + 1.0).abs() < 1e-6);
    }

    #[test]
    fn downmixes_stereo_to_mono() {
        // Two frames: (1.0, -1.0) -> 0.0, (0.5fs, 0.5fs) -> 0.5fs averaged.
        let half = i16::MAX / 2;
        let reader = WavReader::new(wav_i16(2, 8000, &[i16::MAX, i16::MIN, half, half])).unwrap();
        let src = WavFileSource::from_reader(reader).unwrap();
        assert_eq!(
            src.samples.len(),
            2,
            "two stereo frames collapse to two mono samples"
        );
        assert!(
            src.samples[0].abs() < 1e-4,
            "opposite channels cancel to ~0"
        );
        assert!((src.samples[1] - (half as f32 / 32768.0)).abs() < 1e-4);
    }

    #[test]
    fn read_streams_then_signals_eof() {
        let reader = WavReader::new(wav_i16(1, 8000, &[100, 200, 300, 400, 500])).unwrap();
        let mut src = WavFileSource::from_reader(reader).unwrap();
        let mut buf = [0.0f32; 2];
        assert_eq!(src.read(&mut buf).unwrap(), 2);
        assert_eq!(src.read(&mut buf).unwrap(), 2);
        assert_eq!(src.read(&mut buf).unwrap(), 1, "final partial chunk");
        assert_eq!(src.read(&mut buf).unwrap(), 0, "drained");
    }

    #[test]
    fn reads_golden_fixture_clip() {
        // The conformance fixtures are 8 kHz mono 16-bit; cq_clean_20wpm is
        // 116800 samples per fixtures/dsp/index.json. Reading it proves real
        // recorded samples cross into Rust through the seam.
        let mut src = WavFileSource::open(fixture("cq_clean_20wpm.input.wav")).unwrap();
        assert_eq!(src.sample_rate(), 8000);
        let all = src.read_to_end().unwrap();
        assert_eq!(all.len(), 116_800);
        assert!(
            all.iter().all(|s| (-1.0..=1.0).contains(s)),
            "normalized samples stay in [-1, 1]"
        );
        assert!(
            all.iter().any(|&s| s.abs() > 0.05),
            "clip carries real signal, not silence"
        );
    }

    #[test]
    fn missing_file_is_io_error() {
        let result = WavFileSource::open(fixture("does_not_exist.wav"));
        assert!(matches!(result, Err(AudioError::Io(_))));
    }

    #[test]
    fn non_wav_bytes_are_a_decode_error() {
        // Not a RIFF/WAVE container: must surface as an error, not a panic.
        let reader = WavReader::new(Cursor::new(b"this is not a wav file".to_vec()));
        assert!(reader.is_err());
    }
}
