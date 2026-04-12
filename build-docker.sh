#!/usr/bin/env bash
# Build the cw-model Docker image.
#
# Run from either morse/ or cw-ml/model/:
#   ./build-docker.sh [--smoke] [--push REGISTRY/IMAGE:TAG]
#
# Options:
#   --smoke         Run a CPU smoke test after building
#   --push TAG      Tag and push to a registry

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
echo "    Context:    ${SCRIPT_DIR}"
echo ""

docker build \
    -f "${SCRIPT_DIR}/Dockerfile" \
    -t "${IMAGE}" \
    "${SCRIPT_DIR}"

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
