"""
CWNet: Causal CNN + TCN + Chunked BiGRU + CTC head for streaming Morse code decoding.

Input:  (batch, time, 1) — single IQ magnitude envelope at 500 Hz
Output: (batch, time // 2, num_classes) — log probabilities at 250 Hz

Architecture:
  Causal CNN (stride-2 downsampling at layer 1):
    Conv1d(1→64,  k=7, stride=2, causal pad)  → 250 Hz
    Conv1d(64→96, k=5,           causal pad)
    Conv1d(96→128,k=3,           causal pad)

  Causal TCN (4 blocks, dilations 1/2/4/8, receptive field ~120ms):
    Each: Conv1d(128→128, k=3, dilation=d, causal pad=2d) → BN → ReLU
          Conv1d(128→128, k=1) + residual

  Chunked BiGRU:
    Forward GRU: hidden=128, 2 layers, stateful across chunks
    Backward GRU: hidden=128, 2 layers, reset each chunk (limited lookahead)
    CHUNK_FRAMES     = 100 input frames = 200ms @ 250Hz output
    LOOKAHEAD_FRAMES = 50  input frames = 200ms right context

  Head: Linear(256→42) → log_softmax

Total latency: ~64ms DSP + 200ms lookahead + ~10ms inference = ~275ms

Streaming:
  ONNX-friendly forward_chunk() with explicit hidden state I/O:
    Inputs:  envelopes (1, 200, 1), fwd_hidden (2, 1, 128)
    Outputs: log_probs (1, 50, 42), fwd_hidden_next (2, 1, 128)
  No loop unrolling — fixed shape, works in any ONNX runtime.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


BLANK_IDX = 0
CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?=/"
NUM_CLASSES = len(CHARS) + 1  # 42 (blank + 41 characters)

char_to_idx = {c: i + 1 for i, c in enumerate(CHARS)}
idx_to_char = {i + 1: c for i, c in enumerate(CHARS)}
idx_to_char[BLANK_IDX] = ""

# Streaming parameters (in 500 Hz input frames — before CNN stride-2)
CHUNK_FRAMES     = 100   # 200ms of audio per output chunk
LOOKAHEAD_FRAMES = 50    # 200ms right context for backward GRU (at 250Hz output)

# Internal GRU-rate equivalents (after stride-2 CNN downsampling)
_CHUNK_GRU     = CHUNK_FRAMES // 2      # 50 output frames per chunk
_LOOKAHEAD_GRU = LOOKAHEAD_FRAMES       # 50 lookahead frames (at 250Hz)


class _CausalConv1d(nn.Module):
    """Conv1d with causal left-only padding."""
    def __init__(self, in_ch: int, out_ch: int, kernel_size: int,
                 stride: int = 1, dilation: int = 1):
        super().__init__()
        self.pad = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(in_ch, out_ch, kernel_size,
                              stride=stride, dilation=dilation, padding=0)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, C, T)
        x = F.pad(x, (self.pad, 0))
        return self.conv(x)


class _TCNBlock(nn.Module):
    """Causal TCN block: dilated causal conv + pointwise + residual."""
    def __init__(self, channels: int, kernel_size: int, dilation: int):
        super().__init__()
        self.conv1 = _CausalConv1d(channels, channels, kernel_size, dilation=dilation)
        self.bn1 = nn.BatchNorm1d(channels)
        self.conv2 = nn.Conv1d(channels, channels, 1)
        self.bn2 = nn.BatchNorm1d(channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x
        x = F.relu(self.bn1(self.conv1(x)))
        x = self.bn2(self.conv2(x))
        return F.relu(x + residual)


class CWNet(nn.Module):
    def __init__(self, num_classes: int = NUM_CLASSES, gru_hidden: int = 128,
                 gru_layers: int = 2, dropout: float = 0.2, in_channels: int = 1,
                 tcn_channels: int = 128, tcn_blocks: int = 4, **_unused):
        super().__init__()

        # Causal CNN frontend: 500 Hz → 250 Hz (stride-2 at layer 1)
        c0 = max(tcn_channels // 2, 16)
        c1 = max(tcn_channels * 3 // 4, 24)
        c2 = tcn_channels
        self.conv = nn.Sequential(
            # Layer 1: stride-2 downsampling (not MaxPool — cleaner ONNX export)
            _CausalConv1d(in_channels, c0, kernel_size=7, stride=2),
            nn.BatchNorm1d(c0),
            nn.ReLU(),
            # Layer 2
            _CausalConv1d(c0, c1, kernel_size=5),
            nn.BatchNorm1d(c1),
            nn.ReLU(),
            # Layer 3
            _CausalConv1d(c1, c2, kernel_size=3),
            nn.BatchNorm1d(c2),
            nn.ReLU(),
        )

        # Causal TCN: tcn_blocks blocks, dilations 1/2/4/8/...
        self.tcn = nn.Sequential(
            *[_TCNBlock(c2, kernel_size=3, dilation=2**i) for i in range(tcn_blocks)]
        )

        gru_kwargs = dict(
            input_size=c2,
            hidden_size=gru_hidden,
            num_layers=gru_layers,
            batch_first=True,
            bidirectional=False,
            dropout=dropout if gru_layers > 1 else 0,
        )
        self.gru_fwd = nn.GRU(**gru_kwargs)   # stateful across chunks
        self.gru_bwd = nn.GRU(**gru_kwargs)   # resets each chunk (limited lookahead)

        self.head = nn.Linear(gru_hidden * 2, num_classes)
        nn.init.zeros_(self.head.bias)
        nn.init.uniform_(self.head.weight, -0.01, 0.01)

        # Auxiliary tone-on/off head (Phase 3 — feeds the parked HSMM the
        # right-shape sustained envelopes that CTC posteriors never produce).
        # Trained against tone_labels via BCE. ~256 extra params on top of ~880k.
        self.tone_head = nn.Linear(gru_hidden * 2, 1)
        nn.init.zeros_(self.tone_head.bias)
        nn.init.uniform_(self.tone_head.weight, -0.01, 0.01)

    def _cnn_tcn(self, x: torch.Tensor) -> torch.Tensor:
        """x: (B, T, C) → (B, T//2, 128)"""
        x = x.transpose(1, 2)   # (B, C, T)
        x = self.conv(x)         # (B, 128, T//2)
        x = self.tcn(x)          # (B, 128, T//2)
        return x.transpose(1, 2) # (B, T//2, 128)

    def _run_chunked_gru(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (B, T_gru, 128) at GRU rate (250 Hz)
        returns: (B, T_gru, gru_hidden * 2)

        Forward GRU: carries hidden state across chunks for WPM context.
        Backward GRU: resets each chunk — sees LOOKAHEAD_GRU ahead only.
        """
        C = _CHUNK_GRU        # 50 output frames per chunk
        L = _LOOKAHEAD_GRU    # 50 frames of right context
        T = x.shape[1]

        outputs = []
        h_fwd: torch.Tensor | None = None

        start = 0
        while start < T:
            end_out   = min(start + C, T)
            end_chunk = min(start + C + L, T)

            chunk = x[:, start:end_chunk]   # (B, ≤C+L, 128)

            fwd_out, h_fwd = self.gru_fwd(chunk, h_fwd)
            bwd_out, _     = self.gru_bwd(chunk.flip(1))
            bwd_out = bwd_out.flip(1)

            n_out = end_out - start
            combined = torch.cat([fwd_out[:, :n_out], bwd_out[:, :n_out]], dim=-1)
            outputs.append(combined)

            start = end_out

        return torch.cat(outputs, dim=1)   # (B, T_gru, gru_hidden * 2)

    def _features(self, x: torch.Tensor) -> torch.Tensor:
        """CNN + TCN + chunked BiGRU. (B, T, in_ch) → (B, T//2, gru_hidden*2)."""
        x = self._cnn_tcn(x)                # (B, T//2, 128)
        return self._run_chunked_gru(x)     # (B, T//2, gru_hidden*2)

    def forward(self, x: torch.Tensor, input_lengths: torch.Tensor | None = None) -> torch.Tensor:
        """
        x: (batch, time, in_channels) at 500 Hz
        returns: (batch, time // 2, num_classes) log probabilities at 250 Hz
        """
        feat = self._features(x)            # (B, T//2, gru_hidden*2)
        return self.head(feat).log_softmax(dim=-1)

    def forward_dual(self, x: torch.Tensor,
                     input_lengths: torch.Tensor | None = None
                     ) -> tuple[torch.Tensor, torch.Tensor]:
        """Run both CTC head and tone head from one BiGRU pass.

        Used by training (dual-task loss) and the future eval-side tone-emission
        path. The single-head ``forward`` stays as the ONNX export target.

        returns:
          log_probs:   (B, T//2, num_classes), log-softmax over CTC vocab
          tone_logits: (B, T//2) raw logits (LLR; positive = tone-on)
        """
        feat = self._features(x)
        log_probs = self.head(feat).log_softmax(dim=-1)
        tone_logits = self.tone_head(feat).squeeze(-1)
        return log_probs, tone_logits

    @torch.no_grad()
    def infer_dual(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """Like infer() but also returns tone_logits, trimmed identically."""
        B, T, C = x.shape
        warm = torch.zeros(B, CHUNK_FRAMES,     C, device=x.device, dtype=x.dtype)
        tail = torch.zeros(B, LOOKAHEAD_FRAMES, C, device=x.device, dtype=x.dtype)
        log_probs, tone_logits = self.forward_dual(torch.cat([warm, x, tail], dim=1))
        warm_out = CHUNK_FRAMES // 2
        tail_out = LOOKAHEAD_FRAMES // 2
        end = log_probs.shape[1] - tail_out
        return log_probs[:, warm_out:end], tone_logits[:, warm_out:end]

    @torch.no_grad()
    def infer(self, x: torch.Tensor) -> torch.Tensor:
        """
        Full-sequence inference with warm-up and tail silence.

        Prepends CHUNK_FRAMES of silence to warm up the forward GRU,
        appends LOOKAHEAD_FRAMES so the backward GRU has right context
        for the final chunk. Output frames for padding are trimmed.

        x: (B, T, in_channels)
        returns: (B, T//2, num_classes)
        """
        B, T, C = x.shape
        warm = torch.zeros(B, CHUNK_FRAMES,     C, device=x.device, dtype=x.dtype)
        tail = torch.zeros(B, LOOKAHEAD_FRAMES, C, device=x.device, dtype=x.dtype)
        lp = self.forward(torch.cat([warm, x, tail], dim=1))
        warm_out = CHUNK_FRAMES // 2
        tail_out = LOOKAHEAD_FRAMES // 2
        return lp[:, warm_out : lp.shape[1] - tail_out]

    def forward_chunk(
        self,
        envelopes: torch.Tensor,
        fwd_hidden: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Streaming inference: process one chunk with lookahead.

        This is the ONNX export target — fixed shape, explicit hidden state I/O,
        no loop unrolling. The ONNX graph is static and runs in any runtime.

        envelopes:  (1, CHUNK_FRAMES + LOOKAHEAD_FRAMES, in_channels)
                    = (1, 150, 1) — 300ms of audio at 500 Hz
        fwd_hidden: (gru_layers, 1, gru_hidden) = (2, 1, 128)

        Returns:
            log_probs:      (1, CHUNK_FRAMES//2, num_classes) = (1, 50, 42)
            fwd_hidden_next:(gru_layers, 1, gru_hidden) = (2, 1, 128)
        """
        x = self._cnn_tcn(envelopes)   # (1, (C+L)//2, 128)

        fwd_out, h_new = self.gru_fwd(x, fwd_hidden)
        bwd_out, _     = self.gru_bwd(x.flip(1))
        bwd_out = bwd_out.flip(1)

        # Output only the chunk portion (not the lookahead)
        n_out = _CHUNK_GRU  # 50 frames
        combined = torch.cat([fwd_out[:, :n_out], bwd_out[:, :n_out]], dim=-1)
        log_probs = self.head(combined).log_softmax(dim=-1)

        return log_probs, h_new

    def count_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
