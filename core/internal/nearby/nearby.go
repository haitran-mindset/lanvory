package nearby

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Peer represents an untrusted nearby device discovered via BLE / Wi-Fi P2P.
// Discovery metadata is never trusted for authorization.
type Peer struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Tag         string `json:"tag,omitempty"`
	RSSI        int    `json:"rssi"`
	Transport   string `json:"transport"`
	P2PReady    bool   `json:"p2pReady"`
	ServiceName string `json:"serviceName"`
	LastSeen    string `json:"lastSeen"`
}

// Status describes the local Nearby Discovery (BLE + Wi-Fi P2P) adapter state.
type Status struct {
	Supported      bool   `json:"supported"`
	Available      bool   `json:"available"`
	BluetoothState string `json:"bluetoothState"`
	Advertising    bool   `json:"advertising"`
	Scanning       bool   `json:"scanning"`
	P2PListening   bool   `json:"p2pListening"`
	HelperPath     string `json:"helperPath,omitempty"`
	Error          string `json:"error,omitempty"`
}

// ScanResult holds the status and discovered peers from a scan cycle.
type ScanResult struct {
	Status Status `json:"status"`
	Peers  []Peer `json:"peers"`
}

// P2PEndpoint represents an active local loopback bridge to a peer over Wi-Fi P2P.
type P2PEndpoint struct {
	ID          string `json:"id"`
	Endpoint    string `json:"endpoint"`
	ServiceName string `json:"serviceName"`
	Fingerprint string `json:"fingerprint,omitempty"`
	Trusted     bool   `json:"trusted,omitempty"`
}

type helperMsg struct {
	Event          string `json:"event"`
	RequestID      string `json:"requestId,omitempty"`
	BluetoothState string `json:"bluetoothState,omitempty"`
	Advertising    bool   `json:"advertising,omitempty"`
	Scanning       bool   `json:"scanning,omitempty"`
	P2PListening   bool   `json:"p2pListening,omitempty"`
	Peers          []Peer `json:"peers,omitempty"`
	ID             string `json:"id,omitempty"`
	Endpoint       string `json:"endpoint,omitempty"`
	ServiceName    string `json:"serviceName,omitempty"`
	Error          string `json:"error,omitempty"`
}

// Manager supervises the platform-specific Nearby Discovery helper process.
type Manager struct {
	mu          sync.Mutex
	deviceName  string
	deviceTag   string
	helperPath  string
	cmd         *exec.Cmd
	stdin       io.WriteCloser
	status      Status
	lastPeers   []Peer
	pendingScan map[string]chan helperMsg
	pendingDial map[string]chan helperMsg
	endpoints   map[string]bool
	seq         int
	closed      bool
}

// NewManager initializes a platform-independent Nearby Discovery manager.
func NewManager(deviceName, deviceTag string) *Manager {
	supported := runtime.GOOS == "darwin"
	helper := findHelperPath()
	status := Status{
		Supported:      supported,
		Available:      supported && helper != "",
		BluetoothState: "unknown",
		HelperPath:     helper,
	}
	if !supported {
		status.BluetoothState = "unsupported"
	} else if helper == "" {
		status.Error = "lanvory-nearby helper binary not found"
	}
	return &Manager{
		deviceName:  sanitizeText(deviceName, 24),
		deviceTag:   sanitizeText(deviceTag, 12),
		helperPath:  helper,
		status:      status,
		pendingScan: make(map[string]chan helperMsg),
		pendingDial: make(map[string]chan helperMsg),
		endpoints:   make(map[string]bool),
	}
}

func findHelperPath() string {
	if exe, err := os.Executable(); err == nil {
		cand := filepath.Join(filepath.Dir(exe), "lanvory-nearby")
		if st, err := os.Stat(cand); err == nil && !st.IsDir() {
			return cand
		}
	}
	if wd, err := os.Getwd(); err == nil {
		for _, rel := range []string{"bin/lanvory-nearby", "../bin/lanvory-nearby"} {
			cand := filepath.Join(wd, rel)
			if st, err := os.Stat(cand); err == nil && !st.IsDir() {
				return cand
			}
		}
	}
	return ""
}

func (m *Manager) ensureStartedLocked() error {
	if m.closed {
		return errors.New("nearby manager is closed")
	}
	if !m.status.Supported || m.helperPath == "" {
		return errors.New("nearby discovery helper unavailable on this platform")
	}
	if m.cmd != nil {
		return nil
	}
	cmd := exec.Command(m.helperPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	m.cmd = cmd
	m.stdin = stdin
	m.status.Available = true
	m.status.Error = ""

	go m.readLoop(stdout, cmd)
	return nil
}

func (m *Manager) readLoop(r io.Reader, cmd *exec.Cmd) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		var msg helperMsg
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			continue
		}
		m.mu.Lock()
		switch msg.Event {
		case "status":
			if msg.BluetoothState != "" {
				m.status.BluetoothState = msg.BluetoothState
			}
			m.status.Advertising = msg.Advertising
			m.status.Scanning = msg.Scanning
			m.status.P2PListening = msg.P2PListening
		case "scan_result":
			if msg.BluetoothState != "" {
				m.status.BluetoothState = msg.BluetoothState
			}
			m.status.Scanning = false
			cleaned := sanitizePeers(msg.Peers)
			m.lastPeers = cleaned
			if ch, ok := m.pendingScan[msg.RequestID]; ok {
				delete(m.pendingScan, msg.RequestID)
				ch <- msg
			}
		case "p2p_ready", "p2p_error":
			if ch, ok := m.pendingDial[msg.RequestID]; ok {
				delete(m.pendingDial, msg.RequestID)
				ch <- msg
			}
		}
		m.mu.Unlock()
	}
	_ = cmd.Wait()
	m.mu.Lock()
	if m.cmd == cmd {
		m.cmd = nil
		m.stdin = nil
		m.status.Advertising = false
		m.status.Scanning = false
		m.status.P2PListening = false
	}
	m.mu.Unlock()
}

func (m *Manager) sendCmdLocked(payload any) error {
	if err := m.ensureStartedLocked(); err != nil {
		return err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = m.stdin.Write(append(raw, '\n'))
	return err
}

// Status returns the current Nearby Discovery status and last cached peers.
func (m *Manager) Status() ScanResult {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status.Available && m.cmd == nil && !m.closed {
		if err := m.ensureStartedLocked(); err == nil {
			_ = m.sendCmdLocked(map[string]any{"cmd": "status"})
		}
	}
	peers := append([]Peer(nil), m.lastPeers...)
	return ScanResult{Status: m.status, Peers: peers}
}

// SetAdvertising enables or disables BLE advertisement and AWDL P2P listener forwarding.
func (m *Manager) SetAdvertising(enabled bool, targetPort int) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.sendCmdLocked(map[string]any{
		"cmd":        "set_advertise",
		"enabled":    enabled,
		"name":       m.deviceName,
		"tag":        m.deviceTag,
		"targetPort": targetPort,
	}); err != nil {
		m.status.Error = err.Error()
		return m.status, err
	}
	m.status.Advertising = enabled
	return m.status, nil
}

// Scan runs an on-demand BLE + Wi-Fi P2P scan and returns untrusted nearby peers.
func (m *Manager) Scan(ctx context.Context, duration time.Duration) (ScanResult, error) {
	if duration <= 0 {
		duration = 4 * time.Second
	}
	m.mu.Lock()
	m.seq++
	reqID := fmt.Sprintf("scan-%d", m.seq)
	ch := make(chan helperMsg, 1)
	m.pendingScan[reqID] = ch
	m.status.Scanning = true
	err := m.sendCmdLocked(map[string]any{
		"cmd":        "start_scan",
		"requestId":  reqID,
		"durationMs": int(duration.Milliseconds()),
	})
	m.mu.Unlock()
	if err != nil {
		m.mu.Lock()
		delete(m.pendingScan, reqID)
		m.status.Scanning = false
		st := m.status
		m.mu.Unlock()
		return ScanResult{Status: st}, err
	}

	waitCtx, cancel := context.WithTimeout(ctx, duration+4*time.Second)
	defer cancel()
	select {
	case msg := <-ch:
		m.mu.Lock()
		st := m.status
		peers := append([]Peer(nil), m.lastPeers...)
		m.mu.Unlock()
		if msg.Error != "" {
			return ScanResult{Status: st, Peers: peers}, errors.New(msg.Error)
		}
		return ScanResult{Status: st, Peers: peers}, nil
	case <-waitCtx.Done():
		m.mu.Lock()
		delete(m.pendingScan, reqID)
		m.status.Scanning = false
		st := m.status
		peers := append([]Peer(nil), m.lastPeers...)
		m.mu.Unlock()
		return ScanResult{Status: st, Peers: peers}, waitCtx.Err()
	}
}

// ConnectP2P establishes a direct Wi-Fi P2P (AWDL) loopback bridge to serviceName.
func (m *Manager) ConnectP2P(ctx context.Context, serviceName string) (P2PEndpoint, error) {
	cleanSvc := sanitizeText(serviceName, 48)
	if cleanSvc == "" {
		return P2PEndpoint{}, errors.New("serviceName is required")
	}
	m.mu.Lock()
	m.seq++
	reqID := fmt.Sprintf("dial-%d", m.seq)
	ch := make(chan helperMsg, 1)
	m.pendingDial[reqID] = ch
	err := m.sendCmdLocked(map[string]any{
		"cmd":         "p2p_dial",
		"requestId":   reqID,
		"serviceName": cleanSvc,
	})
	m.mu.Unlock()
	if err != nil {
		m.mu.Lock()
		delete(m.pendingDial, reqID)
		m.mu.Unlock()
		return P2PEndpoint{}, err
	}

	waitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	select {
	case msg := <-ch:
		if msg.Event == "p2p_error" {
			return P2PEndpoint{}, errors.New(msg.Error)
		}
		if msg.Endpoint != "" {
			m.mu.Lock()
			m.endpoints[msg.Endpoint] = true
			m.mu.Unlock()
		}
		return P2PEndpoint{
			ID:          msg.ID,
			Endpoint:    msg.Endpoint,
			ServiceName: msg.ServiceName,
		}, nil
	case <-waitCtx.Done():
		m.mu.Lock()
		delete(m.pendingDial, reqID)
		m.mu.Unlock()
		return P2PEndpoint{}, waitCtx.Err()
	}
}

// HasEndpoint reports whether endpoint is an active Wi-Fi P2P bridge created by this manager.
func (m *Manager) HasEndpoint(endpoint string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.endpoints[endpoint]
}

// Close shuts down the helper process cleanly.
func (m *Manager) Close() {
	m.mu.Lock()
	m.closed = true
	stdin := m.stdin
	cmd := m.cmd
	m.mu.Unlock()
	if stdin != nil {
		_, _ = stdin.Write([]byte(`{"cmd":"stop"}` + "\n"))
		_ = stdin.Close()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

func sanitizePeers(in []Peer) []Peer {
	out := make([]Peer, 0, len(in))
	for _, p := range in {
		out = append(out, Peer{
			ID:          sanitizeText(p.ID, 64),
			Name:        sanitizeText(p.Name, 32),
			Tag:         sanitizeText(p.Tag, 16),
			RSSI:        p.RSSI,
			Transport:   sanitizeText(p.Transport, 16),
			P2PReady:    p.P2PReady,
			ServiceName: sanitizeText(p.ServiceName, 48),
			LastSeen:    p.LastSeen,
		})
	}
	return out
}

func sanitizeText(raw string, maxLen int) string {
	raw = strings.TrimSpace(raw)
	var b strings.Builder
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == ' ' {
			b.WriteRune(r)
			if b.Len() >= maxLen {
				break
			}
		}
	}
	return strings.TrimSpace(b.String())
}
