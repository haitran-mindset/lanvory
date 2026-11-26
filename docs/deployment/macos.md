# macOS packaging

From a native macOS arm64 or x64 environment, install the locked Node dependencies and use a Go compiler for the same architecture. A usable macOS SDK and Xcode command-line tools are required.

```sh
pnpm install --frozen-lockfile
make package-macos
make dmg-macos
```

`make package-macos` produces an application bundle. `make dmg-macos` also produces a compressed disk image and its SHA-256 checksum. Every build has a distinct directory in `dist/macos`, so rebuilds preserve previous artifacts. The app embeds Electron, its built renderer, the Go daemon (`lanvoryd`), the CLI (`lanvory`), and—when built on macOS—the Swift Bluetooth + P2P helper (`lanvory-nearby`) inside `Contents/Resources/` along with `NSBluetoothAlwaysUsageDescription` in `Info.plist`. The packaged runtime requires no installed Node.js, Go, or Swift toolchain.

Both commands write a CycloneDX 1.6 `.cdx.json` inventory alongside the bundle. It records Electron as a runtime component, Go runtime versions and modules reported by `lanvory` and `lanvoryd`, and the resolved npm runtime dependency closure used for notice collection. The npm list can include dependencies removed by renderer tree shaking. Electron internals and macOS system libraries are outside this inventory.

The npm packages and Go modules include Package URLs. The SBOM also includes SHA-256 hashes of `lanvory`, `lanvoryd`, and `lanvory-nearby` (when present) as they appear in the signed application bundle.

To package without downloading the Electron archive, set `LANVORY_ELECTRON_ZIP_DIR` to an existing directory containing the platform ZIP for the pinned Electron version. The script checks its SHA-256 against the installed Electron package before extraction. Bring the locked dependencies and Go toolchain into the build environment separately.

For a cross-architecture test on macOS, build the renderer normally, build both Go binaries for the target into a separate directory, then set `LANVORY_MAC_ARCH` to `arm64` or `x64` and `LANVORY_MAC_BIN_DIR` to that directory when invoking `node scripts/package-macos.mjs --dmg`. Set `LANVORY_GO_ROOT` to the Go toolchain used for the build if it is outside PATH. The packager checks the architectures of the daemon, CLI and Electron executable. Rosetta can exercise an x64 test image on Apple Silicon. A physical Intel host is still needed for native Intel verification.

## Local test build

By default the application receives an ad hoc code signature. The build verifies the bundle and native binaries with `codesign`, and verifies the disk image with `hdiutil`. Use the app from the local build or the mounted DMG for testing. When running an ad-hoc signed `.dmg` downloaded from GitHub Releases on another Mac, drag `Lanvory.app` to `Applications` and run `xattr -cr /Applications/Lanvory.app` before launching.

GitHub Actions automates `arm64` and `x64` `.dmg` builds, `smoke-macos-dmg.sh --verify-only` checks, `SHA256SUMS.txt`, and GitHub Release creation on `v*` tags via `.github/workflows/release.yml`.

The ad hoc build is for local testing with an interactive macOS login and accessible Keychain. The ad hoc signing branch leaves hardened runtime disabled to load the bundled Electron framework without a Developer ID Team ID. The Developer ID branch retains the standard hardened-runtime signing behavior and requires notarization before distribution. Existing Lanvory device identity and settings remain in the login Keychain and per-user state directory.

For an isolated launch test, set `LANVORY_STATE_DIR` to a short absolute path under a private test directory. Both the app and any companion CLI invocation must inherit the same value. It selects the Unix socket, SQLite file and inbox location. The device key still belongs to the current login Keychain.

Run `sh scripts/smoke-macos-dmg.sh PATH_TO_LANVORY_DMG` to check a local test image in an interactive macOS login. The script verifies the adjacent checksum, mounts the image read-only, checks the app signature and bundled notices, and starts the app with isolated state. It confirms the bundled CLI can read identity from the app-owned daemon and detaches the image when finished.

When the adjacent CycloneDX inventory is present, the smoke also uses Node.js to compare its two binary hashes against the mounted app before launching it.

Use `--verify-only` for a non-interactive runner. This mode requires the adjacent inventory, verifies the image and signed bundle, and detaches without launching the app or accessing its Keychain identity.

## Developer ID distribution

Set `LANVORY_MAC_SIGN_IDENTITY` to a Developer ID Application identity already configured in the signing machine's Keychain, then build the DMG. This enables identity validation and signing with a secure timestamp. Submit the resulting DMG to Apple with an approved notary credential profile, wait for acceptance, then staple and validate the ticket. Regenerate the SHA-256 file after stapling because the DMG changes. The build does not submit an artifact to an external service automatically.

```sh
xcrun notarytool submit "$image" --keychain-profile "$notary_profile" --wait
xcrun stapler staple "$image"
(cd "$(dirname "$image")" && shasum -a 256 "$(basename "$image")" > "$(basename "$image").sha256")
sh scripts/smoke-macos-dmg.sh --verify-release "$image"
```

Release verification checks the disk image signature and stapled ticket before mounting, then checks the mounted app signature, notices, and SBOM hashes. It does not launch the app.

[Apple's notarization documentation](https://developer.apple.com/documentation/Security/notarizing-macos-software-before-distribution?language=objc)
