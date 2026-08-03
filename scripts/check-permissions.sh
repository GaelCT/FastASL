#!/usr/bin/env bash
# H-13 authoritative POSIX permission validator. Linux only by deployment policy.
set -euo pipefail

case "$(uname -s)" in
  Linux) ;;
  Darwin)
    echo 'Unsupported platform: macOS permission validation is not supported; no result was produced.' >&2
    exit 64
    ;;
  *)
    echo "Unsupported platform: $(uname -s); no permission result was produced." >&2
    exit 64
    ;;
esac

for command in python3 realpath; do
  command -v "$command" >/dev/null 2>&1 || { echo "Unsupported validator environment: required command missing: $command" >&2; exit 69; }
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
exec python3 "$ROOT/scripts/permission-policy.py" validate-tree --root "$ROOT"