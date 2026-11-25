#!/bin/sh
set -eu

verify_only=false
verify_release=false
case "${1:-}" in
  --verify-only) verify_only=true; shift ;;
  --verify-release) verify_only=true; verify_release=true; shift ;;
esac
if [ "$#" -ne 1 ] || [ "$(uname -s)" != Darwin ]; then
  echo 'Usage on macOS: sh scripts/smoke-macos-dmg.sh [--verify-only | --verify-release] PATH_TO_LANVORY_DMG' >&2
  exit 2
fi

image="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
sbom="${image%.dmg}.cdx.json"
if [ "$verify_only" = true ] && [ ! -f "$sbom" ]; then
  echo 'Missing CycloneDX inventory' >&2
  exit 1
fi
expected=$(awk 'NR == 1 {print $1}' "$image.sha256")
actual=$(/usr/bin/shasum -a 256 "$image")
if [ -z "$expected" ] || [ "$expected" != "${actual%% *}" ]; then
  echo 'DMG checksum mismatch' >&2
  exit 1
fi

if [ "$verify_release" = true ]; then
  /usr/bin/codesign --verify --strict "$image"
  /usr/bin/xcrun stapler validate "$image"
fi

work=$(mktemp -d /tmp/lanvory-dmg-smoke.XXXXXX)
mount_dir="$work/mount"
app_pid=
daemon_pid=
mounted=false
cleanup() {
  if [ -n "$app_pid" ]; then
    if [ -z "$daemon_pid" ]; then
      daemon_pid=$(/usr/bin/pgrep -P "$app_pid" -x lanvoryd || true)
    fi
    kill "$app_pid" 2>/dev/null || true
    if [ -n "$daemon_pid" ]; then
      kill "$daemon_pid" 2>/dev/null || true
    fi
    wait "$app_pid" 2>/dev/null || true
  fi

  if [ "$mounted" = true ]; then
    for attempt in 1 2 3 4 5; do
      if /usr/bin/hdiutil detach "$mount_dir" >/dev/null 2>&1; then
        mounted=false
        break
      fi
      sleep 1
    done
    if [ "$mounted" = true ]; then
      echo "Could not detach test image at $mount_dir" >&2
      return 1
    fi
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$mount_dir"
mkdir -m 700 "$work/profile"
/usr/bin/hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$image" >/dev/null
mounted=true
app="$mount_dir/Lanvory.app"
resources="$app/Contents/Resources"
test "$(readlink "$mount_dir/Applications")" = /Applications
/usr/bin/codesign --verify --deep --strict "$app"
test -s "$resources/Notices/Chromium.html"
test -s "$resources/Notices/Go.txt"

if [ -f "$sbom" ]; then
  node - "$sbom" "$resources" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const [sbom, resources] = process.argv.slice(2);
const document = JSON.parse(readFileSync(sbom, 'utf8'));
if (document.bomFormat !== 'CycloneDX' || !Array.isArray(document.components)) {
  throw new Error('Invalid CycloneDX inventory');
}
for (const name of ['lanvory', 'lanvoryd']) {
  const entries = document.components.filter((component) => component.type === 'application' && component.name === name);
  const hashes = entries[0]?.hashes?.filter((hash) => hash.alg === 'SHA-256');
  const actual = createHash('sha256').update(readFileSync(path.join(resources, name))).digest('hex');
  if (entries.length !== 1 || hashes?.length !== 1 || hashes[0].content !== actual) {
    throw new Error(`SBOM SHA-256 mismatch for ${name}`);
  }
}
console.log('Verified both SBOM hashes against the mounted binaries');
NODE
fi

if [ "$verify_only" = true ]; then
  trap - EXIT
  cleanup
  echo 'Verified DMG checksum, mounted signature, notices and SBOM'
  exit 0
fi

unset ELECTRON_RUN_AS_NODE
export LANVORY_STATE_DIR="$work/state"
"$app/Contents/MacOS/Lanvory" --user-data-dir="$work/profile" >"$work/app.log" 2>&1 &
app_pid=$!
# Probe immediately and once more after the final one-second wait.
for attempt in $(jot 31); do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo 'Packaged app exited before becoming ready' >&2
    exit 1
  fi
  if [ -S "$LANVORY_STATE_DIR/daemon.sock" ] && "$resources/lanvory" identity >/dev/null 2>"$work/identity.err"; then
    daemon_pid=$(/usr/bin/pgrep -P "$app_pid" -x lanvoryd || true)
    if [ -n "$daemon_pid" ]; then
      echo 'Verified DMG checksum, mounted signature, bundled daemon and local CLI'
      break
    fi
  fi
  if [ "$attempt" -lt 31 ]; then
    sleep 1
  fi
done

if [ -z "$daemon_pid" ]; then
  daemon_pid=$(/usr/bin/pgrep -P "$app_pid" -x lanvoryd || true)
  if [ -s "$work/app.log" ]; then
    echo 'Packaged app log:' >&2
    /usr/bin/tail -n 80 "$work/app.log" >&2
  fi
  if [ -z "$daemon_pid" ]; then
    echo 'Packaged app had no running daemon child when readiness timed out.' >&2
    /usr/bin/sample "$app_pid" 1 1 2>/dev/null | /usr/bin/sed -n '1,100p' >&2 || true
  elif [ ! -S "$LANVORY_STATE_DIR/daemon.sock" ]; then
    echo 'Packaged daemon was running but had not created its Unix socket when readiness timed out.' >&2
  else
    echo 'Packaged daemon was running with a Unix socket but the bundled CLI did not return identity before the deadline.' >&2
    if [ ! -f "$work/identity.err" ]; then
      echo 'The socket appeared after the last readiness probe.' >&2
    elif [ -s "$work/identity.err" ]; then
      echo 'Last bundled CLI probe stderr:' >&2
      /usr/bin/tail -n 20 "$work/identity.err" >&2
    fi
    /usr/bin/sample "$daemon_pid" 1 1 2>/dev/null | /usr/bin/sed -n '1,120p' >&2 || true
  fi
  exit 1
fi
trap - EXIT
cleanup
