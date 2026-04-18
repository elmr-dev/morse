# CW Model training image
#
# Build context MUST be the morse/ parent directory:
#   cd morse/
#   docker build -f cw-ml/model/Dockerfile -t mpercival/cw-model:latest .
#
# Or use the helper script:
#   ./cw-ml/model/build-docker.sh [--smoke] [--push TAG]
#
# Smoke test (CPU):
#   docker run --rm -e RUN_CMD="pipeline --config configs/debug.yaml" mpercival/cw-model:latest
#
# RunPod usage:
#   docker run --gpus all \
#     -e RUN_CMD="pipeline --config configs/4090.yaml" \
#     -e RUNPOD_API_KEY=xxx \
#     -e S3_BUCKET=ml-runs \
#     -e S3_ENDPOINT_URL=https://....r2.cloudflarestorage.com \
#     -e AWS_ACCESS_KEY_ID=xxx \
#     -e AWS_SECRET_ACCESS_KEY=xxx \
#     -v /workspace:/workspace mpercival/cw-model:latest

# ── Stage 1: build morse-audio from local source ──────────────────────────────
FROM node:24-alpine AS morse-audio-builder

WORKDIR /build
COPY morse-audio/packages/morse-audio/package.json ./
RUN npm install && npm install tsup typescript@~5
COPY morse-audio/tsconfig.base.json /tsconfig.base.json
COPY morse-audio/packages/morse-audio/ ./
RUN npm run build

# ── Stage 2: main training image ──────────────────────────────────────────────
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
ENV UV_SYSTEM_PYTHON=1
RUN uv pip install --system awscli

# ── Copy cw-model source ──────────────────────────────────────────────────────
WORKDIR /app
COPY cw-ml/model/ .

# ── Wire in morse-audio built from local source ───────────────────────────────
COPY morse-audio/packages/morse-audio/package.json morse-audio/packages/morse-audio/package.json
COPY --from=morse-audio-builder /build/dist morse-audio/packages/morse-audio/dist

# ── Install Node dependencies ──────────────────────────────────────────────────
RUN pnpm install

# ── Install Python dependencies ───────────────────────────────────────────────
# Use the base image's conda Python (which already has torch+CUDA) so uv does
# NOT re-download torch (~2.5 GB CPU-only). Install only the non-torch deps.
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
RUN chmod +x /app/docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD []
