# ADR-001 macOS foundation

## Decision

Use the macOS login Keychain via Security.framework for the random Ed25519 seed and the system SQLite library for schema-versioned public profile metadata. Use versioned HTTP over a per-user Unix socket and validate OS peer credentials. The daemon owns both state and identity. Startup fails visibly when the OS store cannot be accessed.

## Tradeoffs

The first runnable slice targets macOS and needs cgo to build. Windows named pipes and credential storage, and Linux credential storage, require dedicated implementations. The SQLite file records the date a public profile was created. The Keychain item owns key continuity. Losing access to the item requires an explicit recovery flow before production use.

## Reference and dependency notes

- [LocalSend protocol](https://github.com/localsend/protocol) demonstrates direct offline communication. Lanvory uses its own daemon protocol.
- [Syncthing device IDs](https://docs.syncthing.net/dev/device-ids.html) show how certificate identities can be matched against saved trust. Lanvory derives an identity from the Ed25519 key and has no global discovery.
- [quic-go](https://github.com/quic-go/quic-go) is an MIT-licensed candidate for peer transport. It is not a dependency of this slice.
- [SQLite](https://www.sqlite.org/copyright.html) publishes its core source in the public domain. This implementation links the macOS system library.
- Installed package metadata identifies Electron, React, React DOM and Zod as MIT, and Lucide React as ISC. This is a direct dependency review. A transitive license and notice inventory is still required for distribution.
