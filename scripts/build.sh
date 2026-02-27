#!/usr/bin/env bash
set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
APP_NAME="fake-api"
REGISTRY="kailima"
IMAGE="${REGISTRY}/${APP_NAME}"

# ─── Version ──────────────────────────────────────────────────────────────────
VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  VERSION=$(date +%Y%m%d%H%M%S)
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "┌──────────────────────────────────────────────────┐"
echo "│  Building ${IMAGE}"
echo "│  Version : ${VERSION}"
echo "└──────────────────────────────────────────────────┘"

# ─── Build ────────────────────────────────────────────────────────────────────
docker build \
  --build-arg APP_VERSION="${VERSION}" \
  -t "${IMAGE}:${VERSION}" \
  -t "${IMAGE}:latest" \
  "${ROOT_DIR}"

echo ""
echo "✔  Build complete: ${IMAGE}:${VERSION}"

# ─── Push ─────────────────────────────────────────────────────────────────────
echo ""
echo "Pushing to Docker Hub..."

docker push "${IMAGE}:${VERSION}"
docker push "${IMAGE}:latest"

echo ""
echo "✔  Pushed:"
echo "   • ${IMAGE}:${VERSION}"
echo "   • ${IMAGE}:latest"
echo ""
echo "To deploy, update the image tag in:"
echo "   manifests/kubernetes/main/deploy.yaml"
