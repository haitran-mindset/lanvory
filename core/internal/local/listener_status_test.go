package local

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"

	"lanvory.local/core/internal/discovery"
)

func TestListenerStatusRoutes(t *testing.T) {
	state := ListenerStatus{State: "local-only"}
	starts, stops := 0, 0
	handler := WithListenerStatus(http.NotFoundHandler(), func() ListenerStatus {
		return state
	}, func(adapter string, bind netip.AddrPort, advertise, quic, pairing bool) error {
		starts++
		if state.State == "listening" {
			return errors.New("already listening")
		}
		if adapter != "en0" || bind.String() != "192.168.1.10:0" || advertise != discovery.CanPublish || !quic {
			t.Fatalf("unexpected start input: %s %s %t %t %t", adapter, bind, advertise, quic, pairing)
		}
		state = ListenerStatus{State: "listening", Adapter: adapter, Endpoint: "192.168.1.10:43110", Pairing: pairing}
		return nil
	}, func() {
		stops++
		state = ListenerStatus{State: "stopped", Adapter: state.Adapter}
	})
	check := func(method, route string, want int) {
		t.Helper()
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, route, nil))
		if response.Code != want {
			t.Fatalf("%s %s: status %d, want %d: %s", method, route, response.Code, want, response.Body)
		}
	}
	const valid = listenerStatusRoute + "/start?interface=en0&bind=192.168.1.10:0"
	check(http.MethodGet, listenerStatusRoute, http.StatusOK)
	check(http.MethodPost, listenerStatusRoute+"/start?interface=en0&bind=[::1]:0", http.StatusBadRequest)
	check(http.MethodPost, valid+"&interface=en1", http.StatusBadRequest)
	check(http.MethodPost, valid+"&pairing=yes", http.StatusBadRequest)
	check(http.MethodPost, valid+"&pairing=false&pairing=true", http.StatusBadRequest)
	check(http.MethodGet, valid, http.StatusNotFound)
	if starts != 0 || stops != 0 {
		t.Fatal("invalid inputs changed the listener")
	}
	check(http.MethodPost, valid, http.StatusOK)
	if !state.Pairing {
		t.Fatal("omitted pairing option must preserve the default")
	}
	check(http.MethodPost, valid, http.StatusConflict)
	check(http.MethodPost, listenerStatusRoute+"/stop", http.StatusOK)
	check(http.MethodPost, valid+"&pairing=false", http.StatusOK)
	if starts != 3 || stops != 1 || state.State != "listening" || state.Pairing {
		t.Fatalf("unexpected final state: %d starts, %d stops, %+v", starts, stops, state)
	}
}
