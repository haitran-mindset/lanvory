package drop

import (
	"testing"
	"time"
)

func TestStreamingElapsedExcludesWaitingAndHistory(t *testing.T) {
	tracker := NewTracker(nil)
	progress := tracker.Start("test", "outgoing", "peer", Manifest{Name: "demo.txt", Size: 100})
	if record := tracker.Snapshot().Transfers[0]; record.StreamingElapsedMS != 0 {
		t.Fatalf("waiting transfer has streaming duration: %+v", record)
	}
	progress.Update(10)
	record := tracker.active["test"]
	record.streamStartedAt = time.Now().Add(-2 * time.Second)
	tracker.active["test"] = record
	progress.Update(40)
	if record := tracker.Snapshot().Transfers[0]; record.StreamingElapsedMS < 2000 || record.Bytes != 40 {
		t.Fatalf("streaming duration or byte count incorrect: %+v", record)
	}
	progress.Update(0)
	if tracker.active["test"].streamStartedAt.Equal(record.streamStartedAt) {
		t.Fatal("new streaming attempt kept the previous start time")
	}
	progress.Finish(nil)
	if record := tracker.Snapshot().Transfers[0]; record.StreamingElapsedMS != 0 {
		t.Fatalf("completed transfer has streaming duration: %+v", record)
	}
}
