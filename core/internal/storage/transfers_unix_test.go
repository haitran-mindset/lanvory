//go:build (darwin || linux) && cgo

package storage

import (
	"context"
	"errors"
	"testing"

	"lanvory.local/core/internal/drop"
)

func TestTransferHistoryPersistsFinalStates(t *testing.T) {
	dir := t.TempDir()
	if _, err := LoadProfile(dir, "owner", "Device"); err != nil {
		t.Fatal(err)
	}
	store := NewTransferHistory(dir, "owner")
	tracker := drop.NewTracker(store)
	outgoing := tracker.Start("", "outgoing", "peer", drop.Manifest{Name: "demo.txt", Size: 20})
	outgoing.Update(10)
	activity := tracker.Snapshot()
	if len(activity.Transfers) != 1 || activity.Transfers[0].State != drop.Streaming || activity.Transfers[0].Bytes != 10 {
		t.Fatalf("activity = %+v", activity)
	}
	if active := drop.NewTracker(store).Snapshot(); len(active.Transfers) != 0 {
		t.Fatal("in-progress transfer was persisted as history")
	}
	outgoing.Finish(nil)
	incoming := tracker.Start("offer", "incoming", "peer", drop.Manifest{Name: "denied.txt", Size: 2})
	incoming.Finish(drop.ErrDeclined)
	cancelled := tracker.Start("cancelled", "outgoing", "peer", drop.Manifest{Name: "cancelled.txt", Size: 2})
	cancelled.Finish(context.Canceled)
	history := drop.NewTracker(store).Snapshot()
	if history.HistoryUnavailable || len(history.Transfers) != 3 ||
		history.Transfers[0].State != drop.Cancelled || history.Transfers[1].State != drop.Declined ||
		history.Transfers[2].State != drop.Completed || history.Transfers[2].Bytes != 20 {
		t.Fatalf("persisted history = %+v", history)
	}
}

func TestDeleteTransferHistoryPersistsAndStaysOwnerScoped(t *testing.T) {
	dir := t.TempDir()
	if _, err := LoadProfile(dir, "owner", "Device"); err != nil {
		t.Fatal(err)
	}
	store := NewTransferHistory(dir, "owner")
	other := NewTransferHistory(dir, "other")
	tracker := drop.NewTracker(store)
	file := drop.Manifest{Name: "demo.txt", Size: 20}
	transfer := tracker.Start("shared-id", "incoming", "peer", file)
	if err := tracker.DeleteHistory("shared-id"); !errors.Is(err, drop.ErrActiveTransfer) {
		t.Fatalf("active transfer deletion = %v", err)
	}
	transfer.Finish(nil)
	if err := other.Record(tracker.Snapshot().Transfers[0]); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := tracker.DeleteHistory("shared-id"); err != nil {
			t.Fatal(err)
		}
	}
	if activity := tracker.Snapshot(); len(activity.Transfers) != 0 {
		t.Fatalf("deleted transfer still in current history: %+v", activity)
	}
	if history := drop.NewTracker(store).Snapshot(); history.HistoryUnavailable || len(history.Transfers) != 0 {
		t.Fatalf("deleted transfer still in reopened history: %+v", history)
	}
	if history := drop.NewTracker(other).Snapshot(); len(history.Transfers) != 1 {
		t.Fatalf("other owner's history changed: %+v", history)
	}
}
