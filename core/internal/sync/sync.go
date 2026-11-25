package syncengine

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

type Mode string

const (
	ModeSendOnly      Mode = "send-only"
	ModeReceiveOnly   Mode = "receive-only"
	ModeBidirectional Mode = "bidirectional"
)

const MaxFilesPerFolder = 5000

var (
	validIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
	ignoredNames   = map[string]bool{
		".git":         true,
		"node_modules": true,
		".DS_Store":    true,
		"Thumbs.db":    true,
	}
)

var (
	ErrInvalidFolderID = errors.New("sync folder ID must match ^[a-z0-9][a-z0-9_-]{0,63}$")
	ErrInvalidMode     = errors.New("sync mode must be send-only, receive-only, or bidirectional")
	ErrInvalidPath     = errors.New("sync path must be an existing absolute directory")
	ErrFolderNotFound  = errors.New("sync folder not found")
	ErrFolderExists    = errors.New("sync folder ID already exists")
)

type FileEntry struct {
	RelativePath string    `json:"relativePath"`
	Size         int64     `json:"size"`
	SHA256       string    `json:"sha256"`
	ModTime      time.Time `json:"modTime"`
	Version      int64     `json:"version"`
}

type Conflict struct {
	RelativePath string    `json:"relativePath"`
	ConflictCopy string    `json:"conflictCopy"`
	DetectedAt   time.Time `json:"detectedAt"`
}

type Folder struct {
	ID         string      `json:"id"`
	Path       string      `json:"path"`
	Mode       Mode        `json:"mode"`
	Paused     bool        `json:"paused"`
	FileCount  int         `json:"fileCount"`
	TotalBytes int64       `json:"totalBytes"`
	LastScanAt *time.Time  `json:"lastScanAt,omitempty"`
	Files      []FileEntry `json:"files,omitempty"`
	Conflicts  []Conflict  `json:"conflicts,omitempty"`
}

type Manager struct {
	mu      sync.RWMutex
	folders map[string]*Folder
}

func NewManager() *Manager {
	return &Manager{folders: make(map[string]*Folder)}
}

func (m *Manager) Restore(folders []Folder) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, f := range folders {
		if !ValidID(f.ID) || !ValidMode(f.Mode) || f.Path == "" {
			continue
		}
		if _, exists := m.folders[f.ID]; !exists {
			cp := f
			m.folders[f.ID] = &cp
		}
	}
}

func ValidID(id string) bool {
	return validIDPattern.MatchString(id)
}

func ValidMode(mode Mode) bool {
	return mode == ModeSendOnly || mode == ModeReceiveOnly || mode == ModeBidirectional
}

// ConflictFilename formats a non-destructive conflict copy name per PROJECT_SPEC §19.
func ConflictFilename(relativePath, deviceLabel string, now time.Time) string {
	cleanDevice := regexp.MustCompile(`[^a-zA-Z0-9_-]`).ReplaceAllString(strings.ToLower(deviceLabel), "-")
	if cleanDevice == "" {
		cleanDevice = "peer"
	}
	dir := filepath.Dir(relativePath)
	base := filepath.Base(relativePath)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	name := fmt.Sprintf("%s.conflict-%s-%s%s", stem, cleanDevice, now.UTC().Format("20060102"), ext)
	if dir == "." {
		return name
	}
	return filepath.Join(dir, name)
}

func (m *Manager) Add(id, folderPath string, mode Mode) (Folder, error) {
	if !ValidID(id) {
		return Folder{}, ErrInvalidFolderID
	}
	if !ValidMode(mode) {
		return Folder{}, ErrInvalidMode
	}
	if !filepath.IsAbs(folderPath) {
		return Folder{}, ErrInvalidPath
	}
	info, err := os.Lstat(folderPath)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return Folder{}, ErrInvalidPath
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.folders[id]; exists {
		return Folder{}, ErrFolderExists
	}
	f := &Folder{
		ID:   id,
		Path: filepath.Clean(folderPath),
		Mode: mode,
	}
	m.folders[id] = f
	return *f, nil
}

func (m *Manager) Remove(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.folders[id]; !exists {
		return ErrFolderNotFound
	}
	delete(m.folders, id)
	return nil
}

func (m *Manager) SetPaused(id string, paused bool) (Folder, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, exists := m.folders[id]
	if !exists {
		return Folder{}, ErrFolderNotFound
	}
	f.Paused = paused
	return *f, nil
}

func (m *Manager) GetFolder(id string) (Folder, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	f, exists := m.folders[id]
	if !exists {
		return Folder{}, false
	}
	return *f, true
}

func (m *Manager) RecordConflict(id string, c Conflict) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, exists := m.folders[id]
	if !exists {
		return
	}
	f.Conflicts = append(f.Conflicts, c)
}

func (m *Manager) List() []Folder {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Folder, 0, len(m.folders))
	for _, f := range m.folders {
		out = append(out, *f)
	}
	slices.SortFunc(out, func(a, b Folder) int {
		return strings.Compare(a.ID, b.ID)
	})
	return out
}

// Scan hashes regular files inside the registered folder (ignoring symlinks and ignored patterns).
func (m *Manager) Scan(id string) (Folder, error) {
	m.mu.RLock()
	f, exists := m.folders[id]
	if !exists {
		m.mu.RUnlock()
		return Folder{}, ErrFolderNotFound
	}
	rootPath := f.Path
	prevByPath := make(map[string]FileEntry, len(f.Files))
	for _, entry := range f.Files {
		prevByPath[entry.RelativePath] = entry
	}
	m.mu.RUnlock()

	var entries []FileEntry
	var totalBytes int64
	err := filepath.WalkDir(rootPath, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		name := d.Name()
		if p != rootPath && (ignoredNames[name] || strings.HasPrefix(name, ".")) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if len(entries) >= MaxFilesPerFolder {
			return filepath.SkipAll
		}
		info, err := d.Info()
		if err != nil || !info.Mode().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(rootPath, p)
		if err != nil || strings.HasPrefix(rel, "..") {
			return nil
		}
		sum, err := hashFile(p)
		if err != nil {
			return nil
		}
		version := int64(1)
		if prev, ok := prevByPath[rel]; ok {
			if prev.SHA256 == sum {
				version = prev.Version
			} else {
				version = prev.Version + 1
			}
		}
		entries = append(entries, FileEntry{
			RelativePath: filepath.ToSlash(rel),
			Size:         info.Size(),
			SHA256:       sum,
			ModTime:      info.ModTime().UTC(),
			Version:      version,
		})
		totalBytes += info.Size()
		return nil
	})
	if err != nil {
		return Folder{}, err
	}

	now := time.Now().UTC()
	m.mu.Lock()
	defer m.mu.Unlock()
	f, exists = m.folders[id]
	if !exists {
		return Folder{}, ErrFolderNotFound
	}
	f.Files = entries
	f.FileCount = len(entries)
	f.TotalBytes = totalBytes
	f.LastScanAt = &now
	return *f, nil
}

func hashFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	h := sha256.New()
	if _, err := io.Copy(h, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
