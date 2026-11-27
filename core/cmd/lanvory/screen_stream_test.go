//go:build darwin || linux

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestScreenStreamKeepsCommandBoundaries(t *testing.T) {
	input := strings.NewReader("{\"action\":\"view\",\"body\":{\"id\":\"first\"}}\n{\"action\":\"send\",\"body\":{\"id\":\"second\"}}\n")
	var output bytes.Buffer
	calls := 0
	err := runScreenStream(input, &output, func(action string, body io.Reader, reply *json.RawMessage) error {
		calls++
		var request struct{ ID string }
		if err := json.NewDecoder(body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if action == "view" && request.ID == "first" {
			return errors.New("temporary daemon error")
		}
		if action != "send" || request.ID != "second" {
			t.Fatalf("unexpected command %s %+v", action, request)
		}
		*reply = json.RawMessage(`{"state":"accepted"}`)
		return nil
	})
	if err != nil || calls != 2 || output.String() != "null\n{\"state\":\"accepted\"}\n" {
		t.Fatalf("calls=%d output=%q error=%v", calls, output.String(), err)
	}
}
