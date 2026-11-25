//go:build linux

package peer

import (
	"errors"
	"net"
	"syscall"
	"testing"

	"golang.org/x/sys/unix"
)

func TestLinuxInterfaceSocketBinding(t *testing.T) {
	loopback, err := net.InterfaceByName("lo")
	if err != nil {
		t.Fatal(err)
	}
	config := net.ListenConfig{Control: bindInterface(loopback.Index)}

	tcp, err := config.Listen(t.Context(), "tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer tcp.Close()
	assertLinuxInterface(t, tcp.(*net.TCPListener), loopback.Index)

	udp, err := config.ListenPacket(t.Context(), "udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer udp.Close()
	assertLinuxInterface(t, udp.(*net.UDPConn), loopback.Index)

	dialer := net.Dialer{Control: bindInterface(loopback.Index)}
	client, err := dialer.DialContext(t.Context(), "tcp4", tcp.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	assertLinuxInterface(t, client.(*net.TCPConn), loopback.Index)
}

func TestLinuxInterfaceSocketBindingRejectsZero(t *testing.T) {
	config := net.ListenConfig{Control: bindInterface(0)}
	socket, err := config.ListenPacket(t.Context(), "udp4", "127.0.0.1:0")
	if socket != nil {
		socket.Close()
	}
	if !errors.Is(err, unix.EINVAL) {
		t.Fatalf("listen with index zero: got %v, want EINVAL", err)
	}
}

func assertLinuxInterface(t *testing.T, socket syscall.Conn, expected int) {
	t.Helper()
	raw, err := socket.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var index int
	var optionErr error
	if err := raw.Control(func(fd uintptr) {
		index, optionErr = unix.GetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_BINDTOIFINDEX)
	}); err != nil {
		t.Fatal(err)
	}
	if optionErr != nil || index != expected {
		t.Fatalf("socket interface index = %d, want %d, error = %v", index, expected, optionErr)
	}
}
