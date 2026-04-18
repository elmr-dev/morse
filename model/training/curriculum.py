"""
Curriculum scheduler for CW decoder training.

Phases progress from easy (high SNR, low WPM, clean) to hard (low SNR, high WPM,
all impairments). Each phase has a gate: only advance when val CER drops below
the threshold within max_epochs.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Phase:
    name: str
    snr_range: list[float]
    wpm_range: list[float]
    impairments: dict | str
    fist: dict | str
    n_train: int
    n_val: int
    max_epochs: int
    gate_cer: float
    lr: float = 1e-3
    warmup_epochs: int = 2

    def as_gen_config(self) -> dict:
        return {
            "snr_range": self.snr_range,
            "wpm_range": self.wpm_range,
            "impairments": self.impairments,
            "fist": self.fist,
            "clip_duration_s": 8.0,
        }


PHASES: dict[str, list[Phase]] = {
    "debug": [
        Phase(
            name="p1_easy",
            snr_range=[0, 10],
            wpm_range=[18, 28],
            impairments="clean",
            fist={"perfect": 0.5, "slight": 0.4, "moderate": 0.1, "poor": 0.0},
            n_train=400,
            n_val=100,
            max_epochs=20,
            gate_cer=0.50,
            lr=1e-3,
        ),
    ],
    "full": [
        Phase(
            name="p1_easy",
            snr_range=[0, 10],
            wpm_range=[18, 28],
            impairments="clean",
            fist={"perfect": 0.4, "slight": 0.4, "moderate": 0.2, "poor": 0.0},
            n_train=10000,
            n_val=1000,
            max_epochs=40,
            gate_cer=0.35,
            lr=1e-3,
            warmup_epochs=3,
        ),
        Phase(
            name="p2_full",
            snr_range=[-18, 6],
            wpm_range=[12, 60],
            impairments={"clean": 0.5, "qsb": 0.5},
            fist={"perfect": 0.2, "slight": 0.35, "moderate": 0.35, "poor": 0.10},
            n_train=100000,
            n_val=2000,
            max_epochs=60,
            gate_cer=0.20,
            lr=2e-4,
            warmup_epochs=2,
        ),
    ],
}


def get_phases(curriculum: str) -> list[Phase]:
    if curriculum not in PHASES:
        raise ValueError(f"Unknown curriculum '{curriculum}'. Choose from: {list(PHASES)}")
    return PHASES[curriculum]
