// Package screenshare manages incoming screen-sharing invitations.
package screenshare

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"image/jpeg"
	"sync"
	"time"
)

const (
	Protocol        = "lanvory-screen-signaling/1"
	MaxDescription  = 10 * 1024
	MaxFrame        = 42 * 1024
	JPEGFormat      = "jpeg/1"
	HDJPEGFormat    = "jpeg/2"
	MaxHDFrame      = 160 * 1024
	UHDJPEGFormat   = "jpeg/3"
	MaxUHDFrame     = 640 * 1024
	MaxMessage      = 896 * 1024
	inviteLifetime  = 45 * time.Second
	sessionLifetime = 2 * time.Hour
	frameTimeout    = 15 * time.Second
	maxSessions     = 16
)

var ErrUnavailable = errors.New("screen sharing invitation unavailable")

type Request struct {
	Action    string    `json:"action"`
	ID        string    `json:"id"`
	Offer     string    `json:"offer,omitempty"`
	HD        bool      `json:"hd,omitempty"`
	UHD       bool      `json:"uhd,omitempty"`
	CreatedAt time.Time `json:"createdAt,omitzero"`
	Frame     []byte    `json:"frame,omitempty"`
	Sequence  uint64    `json:"sequence,omitempty"`
	Stream    bool      `json:"stream,omitempty"`
	Binary    bool      `json:"binary,omitempty"`
}

type Reply struct {
	State  string `json:"state"`
	Answer string `json:"answer,omitempty"`
	Stream bool   `json:"stream,omitempty"`
	Binary bool   `json:"binary,omitempty"`
}

type Invitation struct {
	ID        string    `json:"id"`
	Peer      string    `json:"peer"`
	Offer     string    `json:"offer"`
	HD        bool      `json:"hd,omitempty"`
	UHD       bool      `json:"uhd,omitempty"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type View struct {
	State    string `json:"state"`
	Frame    []byte `json:"frame,omitempty"`
	Sequence uint64 `json:"sequence,omitempty"`
	Wait     bool   `json:"wait,omitempty"`
}

type session struct {
	Invitation
	CreatedAt time.Time
	reply     Reply
	frame     []byte
	sequence  uint64
	frameAt   time.Time
}

type Manager struct {
	mu       sync.Mutex
	sessions map[string]session
	now      func() time.Time
	changed  chan struct{}
}

func New() *Manager {
	return &Manager{sessions: make(map[string]session), now: time.Now, changed: make(chan struct{})}
}

func (m *Manager) signalChange() {
	close(m.changed)
	m.changed = make(chan struct{})
}

func validID(id string) bool {
	value, err := hex.DecodeString(id)
	return err == nil && len(value) == 16
}

func (m *Manager) prune(now time.Time) {
	for id, s := range m.sessions {
		if !now.Before(s.ExpiresAt) {
			delete(m.sessions, id)
		} else if s.reply.State == "accepted" && now.Sub(s.frameAt) >= frameTimeout {
			s.reply = Reply{State: "stopped"}
			s.frame = nil
			s.ExpiresAt = now.Add(inviteLifetime + 10*time.Second)
			m.sessions[id] = s
		}
	}
}

// Handle takes the fingerprint from the authenticated transport, never from the request.
func (m *Manager) Handle(peer string, req Request) (Reply, error) {
	if peer == "" || !validID(req.ID) || len(req.Offer) > MaxDescription || len(req.Frame) > MaxUHDFrame || ((req.HD || req.UHD) && req.Action != "offer") ||
		(req.Action != "frame" && (len(req.Frame) != 0 || req.Sequence != 0)) {
		return Reply{}, ErrUnavailable
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.prune(now)
	current, exists := m.sessions[req.ID]
	if exists && current.Peer != peer {
		return Reply{}, ErrUnavailable
	}
	switch req.Action {
	case "offer":
		if req.Offer == "" || req.CreatedAt.After(now.Add(10*time.Second)) || !now.Before(req.CreatedAt.Add(inviteLifetime)) {
			return Reply{}, ErrUnavailable
		}
		if exists {
			if current.Offer != req.Offer || current.HD != req.HD || current.UHD != req.UHD || !current.CreatedAt.Equal(req.CreatedAt) {
				return Reply{}, ErrUnavailable
			}
			return current.reply, nil
		}
		if len(m.sessions) >= maxSessions {
			return Reply{}, ErrUnavailable
		}
		for _, existing := range m.sessions {
			if existing.reply.State == "pending" || existing.reply.State == "accepted" {
				return Reply{}, ErrUnavailable
			}
		}
		current = session{
			Invitation: Invitation{ID: req.ID, Peer: peer, Offer: req.Offer, HD: req.HD, UHD: req.UHD, ExpiresAt: req.CreatedAt.Add(inviteLifetime)},
			CreatedAt:  req.CreatedAt,
			reply:      Reply{State: "pending"},
		}
	case "frame":
		if !exists || current.reply.State != "accepted" ||
			req.Sequence <= current.sequence || req.Offer != "" || !validFrame(req.Frame, current.reply.Answer) {
			return Reply{}, ErrUnavailable
		}
		current.frame = req.Frame
		current.sequence = req.Sequence
		current.frameAt = now
	case "status", "stop":
		if !exists || req.Offer != "" {
			return Reply{}, ErrUnavailable
		}
		if req.Action == "stop" {
			current.reply = Reply{State: "stopped"}
			current.frame = nil
			current.ExpiresAt = now.Add(inviteLifetime + 10*time.Second)
		}
	default:
		return Reply{}, ErrUnavailable
	}
	m.sessions[req.ID] = current
	if req.Action == "frame" || req.Action == "stop" {
		m.signalChange()
	}
	return current.reply, nil
}

func (m *Manager) Pending() []Invitation {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune(m.now())
	invitations := make([]Invitation, 0, len(m.sessions))
	for _, s := range m.sessions {
		if s.reply.State == "pending" {
			invitations = append(invitations, s.Invitation)
		}
	}
	return invitations
}

func (m *Manager) Decide(id string, accept bool, answer string) error {
	if accept != (answer != "") || len(answer) > MaxDescription {
		return ErrUnavailable
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.prune(now)
	current, exists := m.sessions[id]
	if !exists || current.reply.State != "pending" {
		return ErrUnavailable
	}
	if (answer == HDJPEGFormat && (!current.HD || current.Offer != JPEGFormat)) ||
		(answer == UHDJPEGFormat && (!current.UHD || current.Offer != JPEGFormat)) {
		return ErrUnavailable
	}
	current.reply = Reply{State: "declined"}
	if accept {
		current.reply = Reply{State: "accepted", Answer: answer}
		current.ExpiresAt = now.Add(sessionLifetime)
		current.frameAt = now
	}
	m.sessions[id] = current
	return nil
}

func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.prune(now)
	current, exists := m.sessions[id]
	if !exists {
		return ErrUnavailable
	}
	current.reply = Reply{State: "stopped"}
	current.frame = nil
	current.ExpiresAt = now.Add(inviteLifetime + 10*time.Second)
	m.sessions[id] = current
	m.signalChange()
	return nil
}

func validFrame(frame []byte, format string) bool {
	maxBytes, maxWidth, maxHeight := MaxFrame, 1600, 1200
	switch format {
	case JPEGFormat:
	case HDJPEGFormat:
		maxBytes, maxWidth, maxHeight = MaxHDFrame, 1920, 1440
	case UHDJPEGFormat:
		maxBytes, maxWidth, maxHeight = MaxUHDFrame, 3840, 2160
	default:
		return false
	}
	if len(frame) < 2 || len(frame) > maxBytes || frame[len(frame)-2] != 0xff || frame[len(frame)-1] != 0xd9 {
		return false
	}
	config, err := jpeg.DecodeConfig(bytes.NewReader(frame))
	return err == nil && config.Width > 0 && config.Height > 0 && config.Width <= maxWidth && config.Height <= maxHeight
}

func (m *Manager) View(id string, after uint64, trusted func(string) bool) View {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.view(id, after, trusted)
}

func (m *Manager) WaitView(ctx context.Context, id string, after uint64, trusted func(string) bool) View {
	for {
		m.mu.Lock()
		view := m.view(id, after, trusted)
		changed := m.changed
		m.mu.Unlock()
		if view.State != "accepted" || len(view.Frame) != 0 {
			return view
		}
		select {
		case <-ctx.Done():
			return m.View(id, after, trusted)
		case <-changed:
		}
	}
}

func (m *Manager) view(id string, after uint64, trusted func(string) bool) View {
	now := m.now()
	m.prune(now)
	current, exists := m.sessions[id]
	if !exists || !trusted(current.Peer) {
		return View{State: "stopped"}
	}
	view := View{State: current.reply.State, Wait: current.reply.State == "accepted"}
	if current.reply.State == "accepted" && current.sequence > after && now.Sub(current.frameAt) <= 3*time.Second {
		view.Frame, view.Sequence = current.frame, current.sequence
	}
	return view
}
