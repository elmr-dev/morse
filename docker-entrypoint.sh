#!/usr/bin/env bash
set -e

LOGFILE="/workspace/runs/entrypoint.log"

# Throttle per-batch progress output — RunPod captures every line, and default
# tqdm writes one line per iteration when stdout isn't a TTY. Python training
# code sees CW_QUIET=1 and prints 25% epoch markers instead.
export CW_QUIET=1

# ── S3 upload helper ─────────────────────────────────────────────────────────
upload_to_s3() {
  if [ -z "${S3_BUCKET}" ]; then
    echo "[entrypoint] S3_BUCKET not set — skipping upload"
    return
  fi
  RUNS_SRC="${S3_RUNS_SRC:-/workspace/runs}"
  if [ ! -d "${RUNS_SRC}" ]; then
    echo "[entrypoint] ${RUNS_SRC} not found — skipping upload"
    return
  fi

  echo "[entrypoint] S3_BUCKET=${S3_BUCKET}"
  echo "[entrypoint] S3_ENDPOINT_URL=${S3_ENDPOINT_URL:-<not set>}"
  echo "[entrypoint] AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:+<set>}"
  echo "[entrypoint] Uploading ${RUNS_SRC} to s3://${S3_BUCKET}/cw-model/runs"

  ENDPOINT_ARGS=""
  if [ -n "${S3_ENDPOINT_URL}" ]; then
    ENDPOINT_ARGS="--endpoint-url ${S3_ENDPOINT_URL}"
  fi
  aws s3 sync "${RUNS_SRC}" "s3://${S3_BUCKET}/cw-model/runs" \
      ${ENDPOINT_ARGS} \
      --exclude "*.wav" \
      --exclude "_wav_tmp/*" 2>&1
  local rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "[entrypoint] S3 upload FAILED with exit code ${rc}"
    echo "[entrypoint]   bucket=${S3_BUCKET} endpoint=${S3_ENDPOINT_URL:-<default>}"
    echo "[entrypoint]   aws binary: $(command -v aws)"
    return "${rc}"
  fi
  echo "[entrypoint] Upload complete."
}

# ── Upload logs & artifacts, then terminate RunPod pod on exit ─────────────────
upload_and_stop() {
  local exit_code=$?
  set +e  # don't abort cleanup on errors

  echo "[entrypoint] EXIT trap fired (exit code: ${exit_code})" | tee -a "${LOGFILE}" 2>/dev/null
  upload_to_s3
  local upload_rc=$?

  # Keep the pod alive on failure if requested, so a human can SSH in and
  # inspect ${LOGFILE} / rerun the command manually.
  if [ "${exit_code}" -ne 0 ] || [ "${upload_rc}" -ne 0 ]; then
    if [ "${KEEP_ALIVE_ON_ERROR:-0}" = "1" ]; then
      echo "[entrypoint] Failure detected (exit=${exit_code}, upload=${upload_rc})."
      echo "[entrypoint] KEEP_ALIVE_ON_ERROR=1 — holding pod open for SSH."
      echo "[entrypoint] Manual terminate: runpodctl stop pod ${RUNPOD_POD_ID}"
      sleep infinity
    fi
  fi

  if [ -n "${RUNPOD_API_KEY}" ] && [ -n "${RUNPOD_POD_ID}" ]; then
    echo "[entrypoint] Terminating pod ${RUNPOD_POD_ID} (exit code: ${exit_code})..."
    curl -s -X POST "https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"query\": \"mutation { podTerminate(input: { podId: \\\"${RUNPOD_POD_ID}\\\"})}\"}"
  fi
}
trap upload_and_stop EXIT

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
    echo "[entrypoint] Running: python main.py ${RUN_CMD}"

    # Tee all output to logfile so we capture CUDA errors, OOMs, etc.
    python main.py ${RUN_CMD} 2>&1 | tee -a "${LOGFILE}"
    EXIT_CODE=${PIPESTATUS[0]}

    if [ "${EXIT_CODE}" -ne 0 ]; then
        echo "[entrypoint] python exited with code ${EXIT_CODE}" | tee -a "${LOGFILE}"
        # Upload immediately so logs survive even if trap gets killed
        upload_to_s3
        exit "${EXIT_CODE}"
    fi

    # Upload happens in the EXIT trap (upload_and_stop)
    exit 0
fi

# ── Default: keep container alive for SSH ─────────────────────────────────────
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

echo "[entrypoint] Container ready. SSH in or set RUN_CMD to start training."
exec sleep infinity
