#!/bin/bash
set -euo pipefail

raw_mode="${1:-${BACKGROUND_RUNTIME_MODE:-}}"
normalized_mode="$(
    printf '%s' "${raw_mode}" \
        | tr '[:upper:]' '[:lower:]' \
        | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
)"

case "${normalized_mode}" in
    activity_driven|activity-driven)
        printf '%s\n' activity_driven
        ;;
    *)
        printf '%s\n' continuous
        ;;
esac
