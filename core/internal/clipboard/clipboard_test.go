package clipboard

import (
	"errors"
	"strings"
	"testing"
)

func TestBufferDisabledByDefaultAndLoopPrevention(t *testing.T) {
	buf := NewBuffer()
	if state := buf.State(); state.Enabled || state.Latest != nil {
		t.Fatalf("expected disabled empty state, got %+v", state)
	}

	if accepted, err := buf.Receive("peer1", "hello"); !errors.Is(err, ErrDisabled) || accepted {
		t.Fatalf("expected ErrDisabled, got accepted=%v err=%v", accepted, err)
	}

	buf.SetPolicy(true, false)

	// Loop prevention: marking local text as sent suppresses echo from peer.
	buf.MarkLocalSent("echo-snippet")
	if accepted, err := buf.Receive("peer1", "echo-snippet"); err != nil || accepted {
		t.Fatalf("expected loop suppression (false, nil), got accepted=%v err=%v", accepted, err)
	}

	if accepted, err := buf.Receive("peer1", "new-snippet"); err != nil || !accepted {
		t.Fatalf("expected accepted=true, got accepted=%v err=%v", accepted, err)
	}
	if state := buf.State(); state.Latest == nil || state.Latest.Text != "new-snippet" {
		t.Fatalf("unexpected latest state: %+v", state)
	}

	// Duplicate suppression.
	if accepted, err := buf.Receive("peer1", "new-snippet"); err != nil || accepted {
		t.Fatalf("expected duplicate suppression, got accepted=%v err=%v", accepted, err)
	}

	// Oversize rejection.
	oversized := strings.Repeat("a", MaxBytes+1)
	if _, err := buf.Receive("peer1", oversized); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}

	// Paused state rejection.
	buf.SetPolicy(true, true)
	if _, err := buf.Receive("peer1", "while-paused"); !errors.Is(err, ErrPaused) {
		t.Fatalf("expected ErrPaused, got %v", err)
	}

	// Disabling clears buffer.
	buf.SetPolicy(false, false)
	if state := buf.State(); state.Latest != nil {
		t.Fatalf("expected buffer cleared when disabled, got %+v", state)
	}
}
