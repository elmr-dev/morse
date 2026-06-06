# Confidence Reliability Experiment

Canonical plan: [`../../../notes/confidence-reliability-experiment-2026-06-05.md`](../../../notes/confidence-reliability-experiment-2026-06-05.md)

This directory is the local workspace for the Beat-the-Bot character-confidence track.

## Artifact Policy

Generated WAVs, JSONL manifests, and report JSON files are local experiment artifacts. Keep them out of Git unless a specific fixture becomes a regression test.

Suggested local output layout:

```text
beatbot-val/
  manifest.jsonl
  misses/
reports/
  baseline.json
  calibration.json
  fusion-ablation.json
```

## Run Log

### 2026-06-05

Started the track.

Current next action:

1. Build deterministic Beat-the-Bot validation generation/eval loop.
2. Generate 20 samples at `-9..-12 dB`.
3. Save WAV + diagnostic JSON for fused misses.
4. Classify whether misses are fusion, beam-alternative, true model miss, or split/DSP artifact.
