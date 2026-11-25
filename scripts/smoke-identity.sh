#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
smoke_home=$(mktemp -d /tmp/lanvory-smoke.XXXXXX)
pid=
cleanup() {
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  if [ -f "$smoke_home/daemon.log" ]; then
    cat "$smoke_home/daemon.log" >&2
  fi
  rm -rf -- "$smoke_home"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if "$root/bin/lanvory" identity >/dev/null 2>&1; then
  echo "Stop the running Lanvory daemon before starting this smoke test" >&2
  exit 1
fi
start() {
  "$root/bin/lanvoryd" > "$smoke_home/daemon.log" 2>&1 &
  pid=$!
  attempts=0
  until "$root/bin/lanvory" identity > "$1" 2>/dev/null; do
    if ! kill -0 "$pid" 2>/dev/null || [ "$attempts" -ge 40 ]; then
      return 1
    fi
    attempts=$((attempts + 1))
    sleep 0.25
  done
}
stop() {
  kill "$pid"
  wait "$pid"
  pid=
}

start "$smoke_home/first.json"
"$root/bin/lanvory" network check lo0 192.168.1.3 > "$smoke_home/scope.json"
node -e '
const fs = require("node:fs");
const scope = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (scope.allowed !== false || scope.reason !== "interface_not_active_and_approved") process.exit(1);
' "$smoke_home/scope.json"
pin=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
if "$root/bin/lanvory" peer verify lo0 192.168.1.3:443 "$pin" 2>"$smoke_home/verify.log"; then
  echo "Unapproved peer verification unexpectedly succeeded" >&2
  exit 1
fi
if ! grep -qF "peer endpoint is outside the approved interface scope" "$smoke_home/verify.log"; then
  cat "$smoke_home/verify.log" >&2
  exit 1
fi
"$root/bin/lanvory" permissions check "$pin" file-receive lanvory-smoke-unconfigured > "$smoke_home/permission.json"
node -e '
const fs = require("node:fs");
const decision = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (decision.allowed !== false) process.exit(1);
' "$smoke_home/permission.json"
"$root/bin/lanvory" files incoming > "$smoke_home/offers.json"
node -e '
const fs = require("node:fs");
const offers = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(offers) || offers.length !== 0) process.exit(1);
' "$smoke_home/offers.json"
"$root/bin/lanvory" files transfers > "$smoke_home/transfers.json"
node -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(payload.transfers) || typeof payload.historyUnavailable !== "boolean") process.exit(1);
' "$smoke_home/transfers.json"
"$root/bin/lanvory" services list > "$smoke_home/services.json"
node -e '
const fs = require("node:fs");
if (!Array.isArray(JSON.parse(fs.readFileSync(process.argv[1], "utf8")))) process.exit(1);
' "$smoke_home/services.json"
"$root/bin/lanvory" tunnels list > "$smoke_home/tunnels.json"
node -e '
const fs = require("node:fs");
const tunnels = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(tunnels) || tunnels.length !== 0) process.exit(1);
' "$smoke_home/tunnels.json"
if "$root/bin/lanvory" tunnels open lo0 192.168.1.3:443 "$pin" lanvory-smoke >"$smoke_home/tunnel.log" 2>&1; then
  echo "Unapproved tunnel unexpectedly opened" >&2
  exit 1
fi
if ! grep -qF "peer endpoint is outside the approved interface scope" "$smoke_home/tunnel.log"; then
  cat "$smoke_home/tunnel.log" >&2
  exit 1
fi
"$root/bin/lanvory" pairing list > "$smoke_home/pairing.json"
node -e '
const fs = require("node:fs");
const requests = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(requests) || requests.length !== 0) process.exit(1);
' "$smoke_home/pairing.json"
if "$root/bin/lanvoryd" >> "$smoke_home/daemon.log" 2>&1; then
  echo "Duplicate daemon unexpectedly started" >&2
  exit 1
fi
stop
start "$smoke_home/second.json"
stop
cmp "$smoke_home/first.json" "$smoke_home/second.json"
node -e '
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const identity = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const key = Buffer.from(identity.publicKey, "base64");
const fingerprint = createHash("sha256").update(key).digest("hex");
if (key.length !== 32 || fingerprint !== identity.fingerprint || identity.id !== "ed25519-v1:" + fingerprint) process.exit(1);
' "$smoke_home/second.json"
echo "Verified Keychain identity persistence, fingerprint, scope rejection, default-deny permissions, and duplicate daemon rejection"
