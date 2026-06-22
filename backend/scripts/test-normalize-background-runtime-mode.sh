#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NORMALIZER="${SCRIPT_DIR}/normalize-background-runtime-mode.sh"

assert_mode() {
    local expected="$1"
    local input="$2"
    local actual
    actual="$(bash "${NORMALIZER}" "${input}")"
    if [[ "${actual}" != "${expected}" ]]; then
        echo "expected '${expected}' for '${input}', got '${actual}'" >&2
        exit 1
    fi
}

assert_mode activity_driven activity_driven
assert_mode activity_driven activity-driven
assert_mode activity_driven ACTIVITY_DRIVEN
assert_mode activity_driven "  Activity-Driven  "
assert_mode continuous continuous
assert_mode continuous CONTINUOUS
assert_mode continuous ""
assert_mode continuous invalid

echo "background runtime mode normalization passed"
