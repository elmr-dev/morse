# CW Model training image
#
# Includes:
#   - PyTorch 2.2 + CUDA 12.1 (RTX 4090 / A100)
#   - Node 24 + pnpm  (TypeScript WAV generator via morse-audio)
#   - Python 3.12 + uv  (DSP pipeline + ML training)
#   - awscli  (upload checkpoints to S3/R2)
#
# Build:
#   docker build -t cw-model:latest .
#
# RunPod usage:
#   docker run --gpus all \
#     -e RUN_CMD="pipeline --config configs/base.yaml" \
#     -e RUNPOD_API_KEY=xxx \
#     -e S3_BUCKET=my-bucket \
#     -e AWS_ACCESS_KEY_ID=xxx \
#     -e AWS_SECRET_ACCESS_KEY=xxx \
#     -v /workspace:/workspace cw-model:latest

FROM pytorch/pytorch:2.2.0-cuda12.1-cudnn8-runtime

# ── System packages ────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        git \
        rsync \
        ca-certificates \
        gnupg \
        build-essential \
        vim \
        tmux \
        openssh-client \
    && rm -rf /var/lib/apt/lists/*

# ── Node 24 ────────────────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── pnpm (via corepack) ────────────────────────────────────────────────────────
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── uv ────────────────────────────────────────────────────────────────────────
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# ── AWS CLI ───────────────────────────────────────────────────────────────────
RUN pip install --no-cache-dir awscli

# ── Copy repo ─────────────────────────────────────────────────────────────────
WORKDIR /app
COPY . .

# ── Bake in starting checkpoint (optional) ────────────────────────────────────
COPY checkpoints/ /app/checkpoints/

# ── Install Node dependencies ──────────────────────────────────────────────────
RUN pnpm install --frozen-lockfile

# ── Install Python dependencies ───────────────────────────────────────────────
ENV UV_SYSTEM_PYTHON=1
RUN uv pip install --system \
        numpy \
        scipy \
        soundfile \
        pyyaml \
        python-levenshtein \
        tqdm \
        onnxruntime \
        onnx \
        python-dotenv \
        runpod

# ── Paths ──────────────────────────────────────────────────────────────────────
ENV PYTHONPATH=/app
ENV PATH="/app/node_modules/.bin:${PATH}"

# ── Entrypoint ────────────────────────────────────────────────────────────────
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD []
