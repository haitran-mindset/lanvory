package drop

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func manifestFor(name, data string) Manifest {
	digest := sha256.Sum256([]byte(data))
	return Manifest{Name: name, Size: int64(len(data)), SHA256: hex.EncodeToString(digest[:])}
}

func waitOffer(t *testing.T, receiver *Receiver) Offer {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if pending := receiver.Pending(); len(pending) == 1 {
			return pending[0]
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("offer did not enter the inbox queue")
	return Offer{}
}

func TestReceiveDoesNotReadBeforeApproval(t *testing.T) {
	for _, allow := range []bool{false, true} {
		dir := t.TempDir()
		receiver := NewReceiver(dir, func(string) (bool, error) { return true, nil }, nil)
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		var started atomic.Bool
		outcome := make(chan error, 1)
		go func() {
			outcome <- receiver.Receive(ctx, "trusted", manifestFor("ghi chú.txt", "test"), func() (io.Reader, error) {
				started.Store(true)
				return strings.NewReader("test"), nil
			})
		}()
		offer := waitOffer(t, receiver)
		if started.Load() {
			t.Fatal("read payload before approval")
		}
		if err := receiver.Decide(offer.ID, allow); err != nil {
			t.Fatal(err)
		}
		if err := receiver.Decide(offer.ID, allow); !errors.Is(err, ErrOfferUnavailable) {
			t.Fatal("reused an approval")
		}
		err := <-outcome
		cancel()
		path := filepath.Join(dir, Inbox, offer.Name)
		if !allow {
			if !errors.Is(err, ErrDeclined) || started.Load() {
				t.Fatalf("decline: %v", err)
			}
			if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("a declined offer left a file")
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(path)
		if err != nil || string(data) != "test" {
			t.Fatalf("received bytes = %q, %v", data, err)
		}
	}
}

func TestReceiveReportsPartialProgressBeforeSaving(t *testing.T) {
	dir := t.TempDir()
	receiver := NewReceiver(dir, func(string) (bool, error) { return true, nil }, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	firstChunk := strings.Repeat("a", 64*1024)
	finalChunk := "tail"
	manifest := manifestFor("progress.txt", firstChunk+finalChunk)
	reader, writer := io.Pipe()
	defer writer.Close()
	outcome := make(chan error, 1)
	go func() {
		defer reader.Close()
		outcome <- receiver.Receive(ctx, "trusted", manifest, func() (io.Reader, error) { return reader, nil })
	}()
	offer := waitOffer(t, receiver)
	waiting := receiver.Tracker().Snapshot().Transfers[0]
	if waiting.State != Waiting || waiting.Bytes != 0 || waiting.StreamingElapsedMS != 0 {
		t.Fatalf("transfer before approval = %+v", waiting)
	}
	if err := receiver.Decide(offer.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(writer, firstChunk); err != nil {
		t.Fatal(err)
	}
	for {
		partial := receiver.Tracker().Snapshot().Transfers[0]
		if partial.State == Streaming && partial.Bytes == int64(len(firstChunk)) && partial.StreamingElapsedMS > 0 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("did not observe partial progress: %+v", partial)
		case <-time.After(5 * time.Millisecond):
		}
	}
	filename := filepath.Join(dir, Inbox, offer.Name)
	if _, err := os.Stat(filename); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("destination exposed before verification: %v", err)
	}
	if _, err := io.WriteString(writer, finalChunk); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := <-outcome; err != nil {
		t.Fatal(err)
	}
	finished := receiver.Tracker().Snapshot().Transfers[0]
	if finished.State != Completed || finished.Bytes != manifest.Size || finished.StreamingElapsedMS != 0 {
		t.Fatalf("finished transfer = %+v", finished)
	}
	if data, err := os.ReadFile(filename); err != nil || string(data) != firstChunk+finalChunk {
		t.Fatalf("received file differs: %v", err)
	}
}

func TestReceiveFailuresLeaveNoTemporaryFile(t *testing.T) {
	for _, tc := range []struct {
		name, data                string
		revoke, cancel, collision bool
	}{
		{"checksum", "bad!", false, false, false},
		{"truncated", "ab", false, false, false},
		{"revoked", "test", true, false, false},
		{"cancelled", "test", false, true, false},
		{"late symlink", "test", false, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			var permitted atomic.Bool
			permitted.Store(true)
			receiver := NewReceiver(dir, func(string) (bool, error) { return permitted.Load(), nil }, nil)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			outcome := make(chan error, 1)
			go func() {
				outcome <- receiver.Receive(ctx, "trusted", manifestFor("saved.txt", "test"), func() (io.Reader, error) {
					if tc.revoke {
						permitted.Store(false)
					}
					if tc.cancel {
						cancel()
					}
					if tc.collision {
						if err := os.Symlink("absent", filepath.Join(dir, Inbox, "saved.txt")); err != nil {
							return nil, err
						}
					}
					return strings.NewReader(tc.data), nil
				})
			}()
			offer := waitOffer(t, receiver)
			if err := receiver.Decide(offer.ID, true); err != nil {
				t.Fatal(err)
			}
			if err := <-outcome; err == nil {
				t.Fatal("published an invalid or cancelled payload")
			}
			entries, err := os.ReadDir(filepath.Join(dir, Inbox))
			if err != nil {
				t.Fatal(err)
			}
			if tc.collision {
				if len(entries) != 1 || entries[0].Type()&os.ModeSymlink == 0 {
					t.Fatal("arrival overwrote existing symlink")
				}
			} else if len(entries) != 0 {
				t.Fatalf("left files after failure: %v", entries)
			}
		})
	}
}

func TestManifestValidationAndPermissionDenial(t *testing.T) {
	for _, name := range []string{"../escape", "/absolute", `path\escape`, "NUL.txt", "LPT³.txt", "bad\u202ename", ".hidden", "name."} {
		if err := ValidateManifest(manifestFor(name, "a")); err == nil {
			t.Fatalf("accepted filename %q", name)
		}
	}
	manifest := manifestFor("large.txt", "a")
	manifest.Size = MaxFileSize + 1
	if err := ValidateManifest(manifest); err == nil {
		t.Fatal("accepted oversized manifest")
	}
	receiver := NewReceiver(t.TempDir(), func(string) (bool, error) { return false, nil }, nil)
	err := receiver.Receive(context.Background(), "untrusted", manifestFor("x", "a"), func() (io.Reader, error) {
		t.Fatal("read an unauthorized offer")
		return nil, nil
	})
	if !errors.Is(err, ErrPermission) || len(receiver.Pending()) != 0 {
		t.Fatalf("permission fail-open: %v", err)
	}
}
