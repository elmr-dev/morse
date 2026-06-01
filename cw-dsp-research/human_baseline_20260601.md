# Human CW SNR Baseline — 2026-06-01

Goal: estimate a human copy threshold for 5-character callsign-like tokens
generated from synthetic CW.

Test setup:

- 5 characters per trial: 4 letters + 1 digit, shuffled
- Tone: 650 Hz
- Speed: random 25-35 WPM
- Static bed: fixed RMS noise, with CW signal scaled to target SNR
- Playback: low source amplitude plus `afplay` volume control to avoid output
  ducking/compression artifacts
- Scoring: exact 5-character copy plus Levenshtein character accuracy

Important generator finding:

- `morse-audio` had a high-SNR padding noise bug: padding noise RMS could be
  measured from mixed signal+noise, so tone ramps/tails inflated the padding
  noise floor. This caused audible static-level discontinuities at content
  boundaries.
- The fix measures padding noise from the isolated noise contribution and adds
  regression coverage for a high-SNR `ALY5G` fixture.
- The CLI also now truncates `noiseAudio` to match truncated mixed audio.

Run summary:

| SNR | Trials | Exact | Mean char accuracy |
|---:|---:|---:|---:|
| -6 dB | 1 | 1/1 | 100% |
| -9 dB | 3 | 3/3 | 100% |
| -11 dB | 3 | 3/3 | 100% |
| -12 dB | 4 | 2/4 | 90% |
| -13 dB | 5 | 2/5 | 80% |
| -14 dB | 1 | 0/1 | 60% |
| -15 dB | 3 | 0/3 | 60% |

Overall:

- Exact copy: 11/20 (55%)
- Mean character accuracy: 85%
- Lowest exact copy: -13 dB
- Highest miss: -12 dB

Practical threshold from this run: solid copy through about -11 dB, marginal
around -12 to -13 dB, breaking down by -14 to -15 dB.

