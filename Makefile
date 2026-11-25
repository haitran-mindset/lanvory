GO ?= go
PNPM ?= pnpm

.PHONY: build build-core build-desktop verify desktop package-macos dmg-macos smoke-native

build: build-core build-desktop

build-core:
	mkdir -p bin
	version=$$(node -p "require('./apps/desktop/package.json').version") && cd core && $(GO) build -ldflags "-X main.buildVersion=$$version" -o ../bin/ ./cmd/...

build-desktop:
	$(PNPM) build

verify:
	cd core && $(GO) vet ./...
	cd core && $(GO) test -race ./...
	$(PNPM) typecheck
	node --check apps/desktop/src/main/index.cjs
	node --check apps/desktop/src/main/native-lifecycle.cjs
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
