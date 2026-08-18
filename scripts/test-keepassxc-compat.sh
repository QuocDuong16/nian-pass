#!/bin/sh

set -eu

require_keepassxc=0

if [ "${1:-}" = "--require" ]; then
    require_keepassxc=1
    shift
fi

if [ "$#" -ne 0 ]; then
    echo "Usage: scripts/test-keepassxc-compat.sh [--require]" >&2
    exit 2
fi

if ! command -v keepassxc-cli >/dev/null 2>&1; then
    if [ "$require_keepassxc" -eq 1 ]; then
        echo "FAIL: keepassxc-cli is required for external compatibility" >&2
        exit 1
    fi

    echo "SKIP: keepassxc-cli not found"
    exit 0
fi

keepassxc_version="$(keepassxc-cli --version)"
git_revision="$(git rev-parse --verify HEAD 2>/dev/null || echo unknown)"

echo "KeePassXC version: ${keepassxc_version}"
echo "Nian Pass git SHA: ${git_revision}"
echo "Fixture: keepassxc-2.7.12-kdbx41.kdbx"

NIAN_PASS_REQUIRE_KEEPASSXC=1 timeout 180s \
    cargo test --locked -p kdbx \
    external_keepassxc_roundtrip_preserves_semantics -- \
    --ignored --nocapture --test-threads=1
