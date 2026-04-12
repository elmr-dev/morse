#!/usr/bin/env bash
set -e

# ── Terminate RunPod pod on exit ──────────────────────────────────────────────
stop_pod() {
  if [ -n "${RUNPOD_API_KEY}" ] && [ -n "${RUNPOD_POD_ID}" ]; then
    echo "[entrypoint] Terminating pod ${RUNPOD_POD_ID}..."
    curl -s -X POST "https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"query\": \"mutation { podTerminate(input: { podId: \\\"${RUNPOD_POD_ID}\\\"})}\"}"
  fi
}
trap stop_pod EXIT

# ── Workspace setup ────────────────────────────────────────────────────────────
if [ -d /workspace ]; then
    mkdir -p /workspace/runs

    for dir in runs; do
        target="/workspace/$dir"
        link="/app/$dir"
        if [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; then
            : # already correct
        else
            rm -rf "$link"
            ln -s "$target" "$link"
        fi
    done

    echo "[entrypoint] runs → /workspace/runs"
fi

# ── Optional: run a command via RUN_CMD env var ────────────────────────────────
if [ -n "${RUN_CMD}" ]; then
    echo "[entrypoint] Running: uv run python main.py ${RUN_CMD}"
    uv run python main.py ${RUN_CMD}

    # ── Upload artifacts to S3 / R2 ──────────────────────────────────────────
    if [ -n "${S3_BUCKET}" ]; then
        RUNS_SRC="${S3_RUNS_SRC:-/workspace/runs}"
        if [ ! -d "${RUNS_SRC}" ]; then
            echo "[entrypoint] WARNING: ${RUNS_SRC} not found — skipping upload."
        else
            echo "[entrypoint] Uploading ${RUNS_SRC} to s3://${S3_BUCKET}/cw-model/runs"
            ENDPOINT_ARGS=""
            if [ -n "${S3_ENDPOINT_URL}" ]; then
                ENDPOINT_ARGS="--endpoint-url ${S3_ENDPOINT_URL}"
            fi
            aws s3 sync "${RUNS_SRC}" "s3://${S3_BUCKET}/cw-model/runs" \
                ${ENDPOINT_ARGS} \
                --exclude "*.wav" \
                --exclude "_wav_tmp/*"
            echo "[entrypoint] Upload complete."
        fi
    fi

    exit 0
fi

# ── Default: keep container alive for SSH ─────────────────────────────────────
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

echo "[entrypoint] Container ready. SSH in or set RUN_CMD to start training."
exec sleep infinity
