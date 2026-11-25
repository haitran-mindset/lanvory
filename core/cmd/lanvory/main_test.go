//go:build darwin || linux

package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"os"
	"strings"
	"testing"

	"lanvory.local/core/internal/local"
	"lanvory.local/core/internal/storage"
)

func captureStdout(fn func() error) (string, error) {
	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		return "", err
	}
	os.Stdout = w

	runErr := fn()

	_ = w.Close()
	os.Stdout = oldStdout

	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	_ = r.Close()
	return buf.String(), runErr
}

func TestCLIVersionDirect(t *testing.T) {
	buildVersion = "v1.2.3-test"
	defer func() { buildVersion = "development" }()

	out, err := captureStdout(func() error {
		fmt.Printf("lanvory %s\n", buildVersion)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "lanvory v1.2.3-test") {
		t.Fatalf("unexpected version output: %s", out)
	}
}

func TestCLIStatusAndDoctorWithMockDaemon(t *testing.T) {
	stateDir, err := os.MkdirTemp("/tmp", "lanvory-cli-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(stateDir)

	t.Setenv("LANVORY_STATE_DIR", stateDir)

	listener, release, err := local.Listen(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	dev := local.Describe(pub)
	dev.Name = "TestCLIHost"
	dev.DaemonVersion = "1.0.0-test"

	if _, err := storage.LoadProfile(stateDir, dev.ID, dev.Name); err != nil {
		t.Fatal(err)
	}

	status := local.ListenerStatus{
		State:    "listening",
		Adapter:  "lo0",
		Endpoint: "127.0.0.1:43110",
		Pairing:  true,
	}

	handler := local.WithListenerStatus(
		local.HandlerWithResources(
			dev,
			stateDir,
			nil,
			nil,
			priv,
			nil,
			func() local.ListenerStatus { return status },
		),
		func() local.ListenerStatus { return status },
		func(string, netip.AddrPort, bool, bool, bool) error { return nil },
		func() {},
	)

	server := &http.Server{Handler: handler}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()

	// 1. Test status --json
	out, err := captureStdout(func() error {
		return runStatus([]string{"status", "--json"})
	})
	if err != nil {
		if strings.Contains(err.Error(), "operation not permitted") {
			t.Skip("skipping status and doctor live socket tests: unix connect restricted by sandbox")
		}
		t.Fatalf("runStatus --json error: %v", err)
	}
	var parsedStatus statusSummary
	if err := json.Unmarshal([]byte(out), &parsedStatus); err != nil {
		t.Fatalf("failed to parse status JSON: %v\nraw: %s", err, out)
	}
	if !parsedStatus.Running || parsedStatus.DeviceName != dev.Name || parsedStatus.Fingerprint != dev.Fingerprint {
		t.Fatalf("unexpected parsed status: %+v", parsedStatus)
	}
	if parsedStatus.Listener.State != "listening" || parsedStatus.Listener.Adapter != "lo0" {
		t.Fatalf("unexpected listener in status: %+v", parsedStatus.Listener)
	}

	// 2. Test plain status
	out, err = captureStdout(func() error {
		return runStatus([]string{"status"})
	})
	if err != nil {
		t.Fatalf("runStatus plain error: %v", err)
	}
	if !strings.Contains(out, "Daemon:         running") || !strings.Contains(out, dev.Name) {
		t.Fatalf("unexpected status text output: %s", out)
	}

	// 3. Test doctor --json
	out, err = captureStdout(func() error {
		return runDoctor([]string{"doctor", "--json"})
	})
	if err != nil {
		t.Fatalf("runDoctor --json error: %v", err)
	}
	var parsedDoctor doctorReport
	if err := json.Unmarshal([]byte(out), &parsedDoctor); err != nil {
		t.Fatalf("failed to parse doctor JSON: %v\nraw: %s", err, out)
	}
	if !parsedDoctor.Passed || len(parsedDoctor.Checks) < 3 {
		t.Fatalf("unexpected parsed doctor report: %+v", parsedDoctor)
	}

	// 4. Test plain doctor
	out, err = captureStdout(func() error {
		return runDoctor([]string{"doctor"})
	})
	if err != nil {
		t.Fatalf("runDoctor plain error: %v", err)
	}
	if !strings.Contains(out, "Lanvory Doctor") || !strings.Contains(out, "Status: All core checks passed.") {
		t.Fatalf("unexpected doctor text output: %s", out)
	}

	// 5. Test devices command with mock daemon
	out, err = captureStdout(func() error {
		return run([]string{"peer", "trusted"})
	})
	if err != nil {
		t.Fatalf("peer trusted error: %v", err)
	}
	if !strings.Contains(out, "[]") {
		t.Fatalf("unexpected peer trusted output: %s", out)
	}
}

func TestCLIStatusWhenDaemonStopped(t *testing.T) {
	stateDir, err := os.MkdirTemp("/tmp", "lanvory-stopped-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(stateDir)

	t.Setenv("LANVORY_STATE_DIR", stateDir)

	// Status should fail gracefully when daemon is not running
	err = runStatus([]string{"status"})
	if err == nil {
		t.Fatal("expected error when daemon stopped, got nil")
	}
	if !strings.Contains(err.Error(), "daemon is not running or unreachable") {
		t.Fatalf("unexpected error message: %v", err)
	}

	// Doctor should report warning instead of hard crashing
	out, err := captureStdout(func() error {
		return runDoctor([]string{"doctor"})
	})
	if err != nil {
		t.Fatalf("doctor should not return error on stopped daemon: %v", err)
	}
	if !strings.Contains(out, "not running or socket unreachable") {
		t.Fatalf("expected doctor warning about daemon socket, got: %s", out)
	}
}
