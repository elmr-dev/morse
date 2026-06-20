# `fixtures/dsp/` — golden DSP conformance vectors

Cross-language golden vectors for the 4-channel envelope extractor.

**Authoritative implementation:** the training-side scipy Butterworth pipeline
in `packages/ml/model/data/dsp.py` (synced byte-for-byte in the bandpass block
from `packages/ml/cw-dsp-research/dsp.py`). Every port must match the per-clip
`(T, 4)` envelope here per channel within a small epsilon:

- `apps/web/src/inference/dsp.ts` — current TS port (parity test:
  `apps/web/src/inference/dsp.parity.test.ts`).
- A future Rust decoder (`apps/decoder/…`) when it lands.
- `dsp.py` itself — the fixture is what `dsp.py` produced when it was generated;
  any future change to `dsp.py` must re-regenerate this fixture and bump
  `schema_version` if the contract changes.

## Layout

- `index.json` — manifest: per-clip metadata, channel order, provenance
  (canonical `dsp.py` path, sha256, git short-SHA, regen command).
- `clips/<id>.input.wav` — committed 8 kHz mono PCM-16 input. The TS test and
  the Python generator both read this same WAV so quantization is shared.
- `clips/<id>.envelope.npy` — `(T, 4)` float32, NumPy `.npy` v1 little-endian.
- `clips/<id>.envelope.json` — same data as a flat float array + `shape`, for
  ports without an `.npy` reader.

Channel order (matches `extractEnvelope`):

| ch | name          | description                                   |
|----|---------------|-----------------------------------------------|
| 0  | amplitude     | bandpass + Hilbert + pct-norm + sharpen×2    |
| 1  | tkeo          | Teager-Kaiser on bandpassed signal           |
| 2  | matched_48ms  | 48 ms coherent IQ matched filter             |
| 3  | matched_200ms | 200 ms coherent IQ matched filter            |

## Regenerating

```sh
uv run --script packages/ml/cw-dsp-research/generate_dsp_fixture.py
```

The generator is dependency-light (numpy + scipy) and refuses to run if the
`cw-dsp-research/dsp.py` and `model/data/dsp.py` bandpass blocks ever diverge.

## Ownership

Bootstrapped by John as part of the dsp.ts bandpass fix (RBJ biquad →
Butterworth). The Python generator (`packages/ml/cw-dsp-research/generate_dsp_fixture.py`)
is a proposal for Mark to own/ratify — feel free to relocate, switch the audio
source to morse-audio's CLI, or restructure the on-disk layout. The contract
worth preserving is the `index.json` + `(T, 4)` float32 envelopes.
