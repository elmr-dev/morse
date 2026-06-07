#!/usr/bin/env bash
# Build the cw-model Docker image.
#
# Build context is the morse/ parent directory (needed for local morse-audio source).
# Can be run from either morse/ or packages/ml/model/:
#
#   ./build-docker.sh [--smoke] [--push REGISTRY/IMAGE:TAG]
#
# Options:
#   --smoke         Run a CPU smoke test after building
#   --push TAG      Tag and push to a registry

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MORSE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
IMAGE="mpercival/cw-model:latest"
RUN_SMOKE=false
PUSH_TAG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --smoke) RUN_SMOKE=true; shift ;;
        --push)  PUSH_TAG="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo "=== Building ${IMAGE} ==="
echo "    Context:    ${MORSE_DIR}"
echo "    Dockerfile: ${SCRIPT_DIR}/Dockerfile"
echo ""

docker build \
    -f "${SCRIPT_DIR}/Dockerfile" \
    -t "${IMAGE}" \
    "${MORSE_DIR}"

echo ""
echo "=== Checking image for .env files ==="
ENV_FILES=$(docker run --rm --entrypoint="" "${IMAGE}" find /app -name ".env" -o -name ".env.*" 2>/dev/null)
if [ -n "${ENV_FILES}" ]; then
    echo "ERROR: .env file(s) found in image — aborting:"
    echo "${ENV_FILES}"
    docker rmi "${IMAGE}"
    exit 1
fi
echo "    OK — no .env files found"

echo ""
echo "=== Build complete: ${IMAGE} ==="

if [ "${RUN_SMOKE}" = "true" ]; then
    echo ""
    echo "=== Smoke test: generate + 2-epoch train on CPU ==="
    docker run --rm \
        -e RUN_CMD="pipeline --config configs/debug.yaml" \
        "${IMAGE}"
    echo ""
    echo "=== Smoke test passed ==="
fi

if [ -n "${PUSH_TAG}" ]; then
    echo ""
    echo "=== Tagging and pushing: ${PUSH_TAG} ==="
    docker tag "${IMAGE}" "${PUSH_TAG}"
    docker push "${PUSH_TAG}"
    echo "=== Pushed: ${PUSH_TAG} ==="
fi

echo ""
echo "Run on RunPod (with Cloudflare R2 upload):"
echo ""
echo "  docker run --gpus all \\"
echo "    -e RUN_CMD=\"pipeline --config configs/4090.yaml\" \\"
echo "    -e RUNPOD_API_KEY=\$RUNPOD_API_KEY \\"
echo "    -e S3_BUCKET=ml-runs \\"
echo "    -e S3_ENDPOINT_URL=\$S3_ENDPOINT_URL \\"
echo "    -e AWS_ACCESS_KEY_ID=\$AWS_ACCESS_KEY_ID \\"
echo "    -e AWS_SECRET_ACCESS_KEY=\$AWS_SECRET_ACCESS_KEY \\"
echo "    -v /workspace:/workspace \\"
echo "    ${IMAGE}"
