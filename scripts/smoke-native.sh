#!/bin/sh
set -eu

profiles=$(mktemp -d /tmp/lanvory-native.XXXXXX)
cleanup() { rm -rf -- "$profiles"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
unset ELECTRON_RUN_AS_NODE

mkdir -m 700 "$profiles/owned" "$profiles/external"
LANVORY_NATIVE_SMOKE_PROFILE="$profiles/owned" "$1" --filter @lanvory/desktop exec electron tests/native-smoke.cjs
LANVORY_NATIVE_SMOKE_PROFILE="$profiles/external" "$1" --filter @lanvory/desktop exec electron tests/native-smoke.cjs --external-daemon
