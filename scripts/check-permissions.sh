#!/usr/bin/env bash
#
# H-13: Verify source, configuration, and runtime file permissions.
#
# Fails when:
#   - any code/configuration file is group- or world-writable
#   - .env is world-readable or world-writable
#   - runtime directories (var/) are world-writable
#
# Usage: bash scripts/check-permissions.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILURES=0

fail() {
    echo "FAIL: $1"
    FAILURES=$((FAILURES + 1))
}

# 1. Code/config directories: no group/world write bits (mode & 022 == 0)
for dir in backend public database docs tests scripts; do
    while IFS= read -r file; do
        fail "group/world-writable file: $file ($(stat -c '%a' "$file"))"
    done < <(find "$dir" -type f -perm /022 2>/dev/null)
done

# 2. Root manifests must not carry group/world write bits
for file in composer.json package.json phpunit.xml.dist eslint.config.js \
            .htaccess .env.example .gitignore; do
    if [ -f "$file" ] && [ "$((0$(stat -c '%a' "$file") & 022))" -ne 0 ]; then
        fail "group/world-writable file: $file ($(stat -c '%a' "$file"))"
    fi
done

# 3. .env (when present) must be owner-only or owner+group (600 / 640)
if [ -f .env ]; then
    mode="$(stat -c '%a' .env)"
    if [ "$mode" != "600" ] && [ "$mode" != "640" ]; then
        fail ".env mode is $mode (expected 600 or 640)"
    fi
fi

# 4. Runtime directories (var/) must not be world-writable
for dir in var var/log var/cache; do
    if [ -d "$dir" ]; then
        mode="$(stat -c '%a' "$dir")"
        if [ "$((0$mode & 002))" -ne 0 ]; then
            fail "runtime directory $dir is world-writable ($mode)"
        fi
    fi
done

if [ "$FAILURES" -gt 0 ]; then
    echo ""
    echo "$FAILURES permission problem(s) found. See ASL_Revive_Project_Audit.md H-13."
    exit 1
fi

echo "OK: permissions are safe."
