//go:build darwin || linux

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"

	"lanvory.local/core/internal/local"
	"lanvory.local/core/internal/screenshare"
)

func screenStream(ctx context.Context, dir string, input io.Reader, output io.Writer) error {
	request, closeIdle := local.OpenScreenMedia(dir)
	defer closeIdle()
	return runScreenStream(input, output, func(action string, body io.Reader, response *json.RawMessage) error {
		return request(ctx, action, body, response)
	})
}

func runScreenStream(input io.Reader, output io.Writer, request func(string, io.Reader, *json.RawMessage) error) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), screenshare.MaxMessage+1024)
	for scanner.Scan() {
		var command struct {
			Action string          `json:"action"`
			Body   json.RawMessage `json:"body"`
		}
		var reply json.RawMessage
		if json.Unmarshal(scanner.Bytes(), &command) != nil || (command.Action != "send" && command.Action != "view") {
			return errors.New("invalid screen stream command")
		}
		if request(command.Action, bytes.NewReader(command.Body), &reply) != nil || len(reply) == 0 {
			reply = json.RawMessage("null")
		}
		// Daemon responses are single-line JSON. Send them without re-encoding
		// the large Base64 frame inside each response.
		reply = bytes.TrimSpace(reply)
		if bytes.ContainsAny(reply, "\r\n") {
			var compact bytes.Buffer
			if err := json.Compact(&compact, reply); err != nil {
				return err
			}
			reply = compact.Bytes()
		}
		if _, err := output.Write(append(reply, '\n')); err != nil {
			return err
		}
	}
	return scanner.Err()
}
