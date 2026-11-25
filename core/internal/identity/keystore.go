//go:build darwin || linux

package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

const keyFileName = "identity.key"

// Load reads or creates the Ed25519 device identity seed in dir with owner-only permissions.
func Load(dir string) (ed25519.PrivateKey, error) {
	if !filepath.IsAbs(dir) {
		return nil, errors.New("identity directory must be absolute")
	}
	if err := checkPrivateDir(dir); err != nil {
		return nil, err
	}

	keyPath := filepath.Join(dir, keyFileName)
	seed := make([]byte, ed25519.SeedSize)
	defer clear(seed)

	read, err := readSeedFile(keyPath, seed)
	if err != nil {
		return nil, err
	}
	if !read {
		if _, err := rand.Read(seed); err != nil {
			return nil, err
		}
		if err := writeSeedFile(dir, keyPath, seed); err != nil {
			if errors.Is(err, os.ErrExist) {
				if _, readErr := readSeedFile(keyPath, seed); readErr == nil {
					return ed25519.NewKeyFromSeed(seed), nil
				}
			}
			return nil, err
		}
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

func checkPrivateDir(dir string) error {
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.IsDir() || info.Mode().Perm() != 0700 || !ok || stat.Uid != uint32(os.Geteuid()) {
		return errors.New("identity directory must be an owner-only directory (0700)")
	}
	return nil
}

func readSeedFile(keyPath string, seed []byte) (bool, error) {
	info, err := os.Lstat(keyPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || !ok || stat.Uid != uint32(os.Geteuid()) {
		return false, fmt.Errorf("%s must be an owner-only regular file (0600)", keyFileName)
	}

	file, err := os.OpenFile(keyPath, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return false, err
	}
	defer file.Close()

	n, err := io.ReadFull(file, seed)
	if err != nil {
		return false, fmt.Errorf("read %s: %w", keyFileName, err)
	}
	if n != len(seed) {
		return false, fmt.Errorf("invalid %s size", keyFileName)
	}
	var extra [1]byte
	if extraN, extraErr := file.Read(extra[:]); extraN > 0 || (extraErr != nil && !errors.Is(extraErr, io.EOF)) {
		return false, fmt.Errorf("invalid %s size", keyFileName)
	}
	return true, nil
}

func writeSeedFile(dir, keyPath string, seed []byte) error {
	file, err := os.CreateTemp(dir, ".identity.key.*")
	if err != nil {
		return err
	}
	tmpPath := file.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if err := file.Chmod(0600); err != nil {
		_ = file.Close()
		return err
	}
	if err := writeAll(file, seed); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Link(tmpPath, keyPath); err != nil {
		return err
	}
	_ = os.Remove(tmpPath)
	cleanup = false

	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}

func writeAll(w io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := w.Write(data)
		if err != nil {
			return err
		}
		data = data[n:]
	}
	return nil
}
