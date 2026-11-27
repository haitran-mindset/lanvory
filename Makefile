GO ?= go
PNPM ?= pnpm

.PHONY: build build-core build-desktop verify desktop package-macos dmg-macos smoke-native

build: build-core build-desktop

build-core:
	mkdir -p bin
	version=$$(node -p "require('./apps/desktop/package.json').version") && cd core && $(GO) build -ldflags "-X main.buildVersion=$$version" -o ../bin/ ./cmd/...
	@if [ "$$(uname -s)" = "Darwin" ] && command -v swiftc >/dev/null 2>&1; then \
		swiftc -O -framework CoreBluetooth -framework Network core/native/darwin/lanvory-nearby.swift -o bin/lanvory-nearby; \
	fi
	@if [ "$$(uname -s)" = "Darwin" ]; then \
		node_headers=$$(node -p "require('path').resolve(require('fs').realpathSync(process.execPath), '../../include/node')") && \
		xcrun clang -O2 -bundle -undefined dynamic_lookup -mmacosx-version-min=10.15 -I "$$node_headers" -framework CoreGraphics core/native/darwin/screen-permission.c -o bin/screen-permission.node; \
	fi

build-desktop:
	$(PNPM) build

verify:
	cd core && $(GO) vet ./...
	cd core && $(GO) test -race ./...
	$(PNPM) typecheck
	node --check apps/desktop/src/main/index.cjs
	node --check apps/desktop/src/main/native-lifecycle.cjs
	node --test apps/desktop/tests/release-update.test.cjs
	node --check apps/desktop/tests/native-smoke.cjs
	node --check apps/desktop/src/preload/index.cjs
	node --check scripts/package-macos.mjs
	sh -n scripts/smoke-identity.sh
	sh -n scripts/smoke-native.sh
	sh -n scripts/smoke-macos-dmg.sh
	sh -n scripts/measure-perf.sh

desktop:
	$(PNPM) desktop

package-macos: build
	LANVORY_GO_ROOT="$$($(GO) env GOROOT)" node scripts/package-macos.mjs

dmg-macos: build
	LANVORY_GO_ROOT="$$($(GO) env GOROOT)" node scripts/package-macos.mjs --dmg

smoke-native: build
	sh scripts/smoke-native.sh "$(PNPM)"
