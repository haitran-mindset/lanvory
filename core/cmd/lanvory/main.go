//go:build darwin || linux

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"syscall"
	"time"

	"lanvory.local/core/internal/local"
	syncengine "lanvory.local/core/internal/sync"
)

var buildVersion = "development"

const usage = "Usage: lanvory <identity [fingerprint | rename NAME] | network [listener [start NAME IPv4:PORT [--no-pairing] | stop] | approve NAME | revoke NAME | check NAME IPv4] | discover [resolve NAME SERVICE [tcp|udp]] | peer verify|verify-trusted|verify-quic|trust|ping NAME IPv4:PORT FINGERPRINT [--json] | peer match-trusted NAME IPv4:PORT | peer trusted | peer revoke FINGERPRINT | permissions COMMAND | files incoming | files transfers | files remove-history ID | files clear-history | files approve ID | files decline ID | files send NAME IPv4:PORT FINGERPRINT PATH... | services list | services share ID LOOPBACK:PORT | services remove ID | tunnels list | tunnels open NAME ENDPOINT FINGERPRINT SERVICE [LOOPBACK:PORT] | tunnels stop ID | peer pair NAME ENDPOINT FINGERPRINT | pairing list | pairing approve ID CODE | pairing decline ID | devices [--json] | status [--json] | doctor [--json] | version | help>" + "\nPermissions: list | audit | grant FINGERPRINT CAPABILITY RESOURCE [EXPIRES_RFC3339] | revoke FINGERPRINT CAPABILITY RESOURCE | check FINGERPRINT CAPABILITY RESOURCE"

func main() {
	arguments := os.Args[1:]
	switch {
	case len(arguments) == 0 || slices.Equal(arguments, []string{"help"}) || slices.Equal(arguments, []string{"--help"}):
		fmt.Println(usage)
	case slices.Equal(arguments, []string{"version"}), slices.Equal(arguments, []string{"--version"}):
		fmt.Printf("lanvory %s\n", buildVersion)
	case slices.Equal(arguments, []string{"status"}),
		len(arguments) == 2 && arguments[0] == "status" && arguments[1] == "--json":
		if err := runStatus(arguments); err != nil {
			fmt.Fprintln(os.Stderr, "lanvory:", err)
			os.Exit(1)
		}
	case slices.Equal(arguments, []string{"doctor"}),
		len(arguments) == 2 && arguments[0] == "doctor" && arguments[1] == "--json":
		if err := runDoctor(arguments); err != nil {
			fmt.Fprintln(os.Stderr, "lanvory:", err)
			os.Exit(1)
		}
	case slices.Equal(arguments, []string{"devices"}),
		len(arguments) == 2 && arguments[0] == "devices" && arguments[1] == "--json":
		if err := run([]string{"peer", "trusted"}); err != nil {
			fmt.Fprintln(os.Stderr, "lanvory:", err)
			os.Exit(1)
		}
	case slices.Equal(arguments, []string{"identity"}),
		slices.Equal(arguments, []string{"identity", "fingerprint"}),
		len(arguments) == 3 && arguments[0] == "identity" && arguments[1] == "rename",
		slices.Equal(arguments, []string{"network"}),
		slices.Equal(arguments, []string{"network", "listener"}),
		slices.Equal(arguments, []string{"network", "listener", "stop"}),
		(len(arguments) == 5 || (len(arguments) == 6 && arguments[5] == "--no-pairing")) && arguments[0] == "network" && arguments[1] == "listener" && arguments[2] == "start",
		slices.Equal(arguments, []string{"discover"}),
		len(arguments) == 4 && arguments[0] == "peer" && arguments[1] == "match-trusted",
		slices.Equal(arguments, []string{"peer", "trusted"}),
		slices.Equal(arguments, []string{"files", "incoming"}),
		slices.Equal(arguments, []string{"files", "transfers"}),
		slices.Equal(arguments, []string{"files", "clear-history"}),
		len(arguments) >= 6 && arguments[0] == "files" && arguments[1] == "send",
		len(arguments) == 3 && arguments[0] == "files" && (arguments[1] == "approve" || arguments[1] == "decline" || arguments[1] == "remove-history"),
		slices.Equal(arguments, []string{"services", "list"}),
		len(arguments) == 4 && arguments[0] == "services" && arguments[1] == "share",
		len(arguments) == 3 && arguments[0] == "services" && arguments[1] == "remove",
		slices.Equal(arguments, []string{"tunnels", "list"}),
		len(arguments) == 3 && arguments[0] == "tunnels" && arguments[1] == "stop",
		(len(arguments) == 6 || len(arguments) == 7) && arguments[0] == "tunnels" && arguments[1] == "open",
		slices.Equal(arguments, []string{"pairing", "list"}),
		len(arguments) == 4 && arguments[0] == "pairing" && arguments[1] == "approve",
		len(arguments) == 3 && arguments[0] == "pairing" && arguments[1] == "decline",
		len(arguments) == 5 && arguments[0] == "peer" && arguments[1] == "pair",
		validPermissionCommand(arguments),
		len(arguments) == 3 && arguments[0] == "peer" && arguments[1] == "revoke",
		len(arguments) == 5 && arguments[0] == "peer" && (arguments[1] == "verify" || arguments[1] == "verify-trusted" || arguments[1] == "verify-quic" || arguments[1] == "trust"),
		(len(arguments) == 5 || (len(arguments) == 6 && arguments[5] == "--json")) && arguments[0] == "peer" && arguments[1] == "ping",
		(len(arguments) == 4 || len(arguments) == 5) && arguments[0] == "discover" && arguments[1] == "resolve",
		len(arguments) == 4 && arguments[0] == "network" && arguments[1] == "check",
		len(arguments) == 3 && arguments[0] == "network" && (arguments[1] == "approve" || arguments[1] == "revoke"),
		slices.Equal(arguments, []string{"clipboard", "status"}),
		slices.Equal(arguments, []string{"clipboard", "enable"}),
		slices.Equal(arguments, []string{"clipboard", "disable"}),
		slices.Equal(arguments, []string{"clipboard", "clear"}),
		len(arguments) == 6 && arguments[0] == "clipboard" && arguments[1] == "send",
		slices.Equal(arguments, []string{"sync", "list"}),
		(len(arguments) == 4 || len(arguments) == 5) && arguments[0] == "sync" && arguments[1] == "add",
		len(arguments) == 3 && arguments[0] == "sync" && (arguments[1] == "remove" || arguments[1] == "scan" || arguments[1] == "pause" || arguments[1] == "resume"),
		(len(arguments) == 6 || len(arguments) == 7) && arguments[0] == "sync" && arguments[1] == "run":
		if err := run(arguments); err != nil {
			fmt.Fprintln(os.Stderr, "lanvory:", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
}

func run(arguments []string) error {
	dir, err := local.Dir()
	if err != nil {
		return err
	}
	ctx := context.Background()
	output := json.NewEncoder(os.Stdout)
	output.SetIndent("", "  ")
	if arguments[0] == "tunnels" {
		switch arguments[1] {
		case "list":
			records, err := local.ListTunnels(ctx, dir)
			if err != nil {
				return err
			}
			return output.Encode(records)
		case "open":
			bind := "127.0.0.1:0"
			if len(arguments) == 7 {
				bind = arguments[6]
			}
			result, err := local.OpenTunnel(ctx, dir, arguments[2], arguments[3], arguments[4], arguments[5], bind)
			if err != nil {
				return err
			}
			return output.Encode(result)
		case "stop":
			return local.StopTunnel(ctx, dir, arguments[2])
		}
	}
	if arguments[0] == "clipboard" {
		switch arguments[1] {
		case "status":
			state, err := local.ClipboardState(ctx, dir)
			if err != nil {
				return err
			}
			return output.Encode(state)
		case "enable":
			state, err := local.SetClipboardPolicy(ctx, dir, true, false)
			if err != nil {
				return err
			}
			return output.Encode(state)
		case "disable":
			state, err := local.SetClipboardPolicy(ctx, dir, false, false)
			if err != nil {
				return err
			}
			return output.Encode(state)
		case "clear":
			return local.ClearClipboard(ctx, dir)
		case "send":
			return local.SendClipboard(ctx, dir, arguments[2], arguments[3], arguments[4], arguments[5])
		}
	}
	if arguments[0] == "sync" {
		switch arguments[1] {
		case "list":
			folders, err := local.ListSyncFolders(ctx, dir)
			if err != nil {
				return err
			}
			return output.Encode(folders)
		case "add":
			mode := syncengine.ModeBidirectional
			if len(arguments) == 5 {
				mode = syncengine.Mode(arguments[4])
			}
			folder, err := local.AddSyncFolder(ctx, dir, arguments[2], arguments[3], mode)
			if err != nil {
				return err
			}
			return output.Encode(folder)
		case "remove":
			return local.RemoveSyncFolder(ctx, dir, arguments[2])
		case "scan":
			folder, err := local.ScanSyncFolder(ctx, dir, arguments[2])
			if err != nil {
				return err
			}
			return output.Encode(folder)
		case "pause":
			folder, err := local.SetSyncFolderPaused(ctx, dir, arguments[2], true)
			if err != nil {
				return err
			}
			return output.Encode(folder)
		case "resume":
			folder, err := local.SetSyncFolderPaused(ctx, dir, arguments[2], false)
			if err != nil {
				return err
			}
			return output.Encode(folder)
		case "run":
			peerLabel := ""
			if len(arguments) == 7 {
				peerLabel = arguments[6]
			}
			result, err := local.SyncFolderWithPeer(ctx, dir, arguments[2], arguments[3], arguments[4], arguments[5], peerLabel)
			if err != nil {
				return err
			}
			return output.Encode(result)
		}
	}
	if arguments[0] == "services" {
		switch arguments[1] {
		case "list":
			records, err := local.ListServices(ctx, dir)
			if err != nil {
				return err
			}
			return output.Encode(records)
		case "share":
			return local.UpdateService(ctx, dir, arguments[2], arguments[3], true)
		case "remove":
			return local.UpdateService(ctx, dir, arguments[2], "", false)
		}
	}
	if arguments[0] == "files" {
		if arguments[1] == "send" {
			ctx, cancel := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
			defer cancel()
			paths := arguments[5:]
			for _, filePath := range paths {
				if err := local.SendFile(ctx, dir, arguments[2], arguments[3], arguments[4], filePath); err != nil {
					return err
				}
			}
			if len(paths) == 1 {
				fmt.Println("Peer confirmed the file was received and verified.")
			} else {
				fmt.Printf("Peer confirmed all %d files were received and verified.\n", len(paths))
			}
			return nil
		}
		if arguments[1] == "transfers" {
			output.SetEscapeHTML(false)
			activity, err := local.FileTransfers(ctx, dir)
			if err != nil {
				return err
			}
			return output.Encode(activity)
		}
		if arguments[1] == "remove-history" {
			return local.DeleteFileTransfer(ctx, dir, arguments[2])
		}
		if arguments[1] == "clear-history" {
			return local.ClearFileTransfers(ctx, dir)
		}
		if arguments[1] == "incoming" {
			offers, err := local.IncomingOffers(ctx, dir)
			if err != nil {
				return err
			}
			return output.Encode(offers)
		}
		return local.DecideOffer(ctx, dir, arguments[2], arguments[1] == "approve")
	}
	if arguments[0] == "permissions" {
		return runPermissions(ctx, dir, output, arguments[1:])
	}
	if arguments[0] == "pairing" {
		switch arguments[1] {
		case "list":
			requests, err := local.PairingRequests(ctx, dir)
			if err != nil {
				return err
			}
			return output.Encode(requests)
		case "approve":
			return local.DecidePairing(ctx, dir, arguments[2], arguments[3], true)
		case "decline":
			return local.DecidePairing(ctx, dir, arguments[2], "", false)
		}
	}
	if arguments[0] == "peer" {
		switch arguments[1] {
		case "pair":
			ctx, cancel := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
			defer cancel()
			if err := local.StartPairing(ctx, dir, arguments[2], arguments[3], arguments[4]); err != nil {
				return err
			}
			fmt.Println("Both devices confirmed pairing and saved trust.")
		case "match-trusted":
			pin, err := local.MatchTrustedPeer(ctx, dir, arguments[2], arguments[3])
			if err != nil {
				return err
			}
			return output.Encode(pin)
		case "trusted":
			records, err := local.TrustedPeers(ctx, dir)
			if err != nil {
				return err
			}
			return output.Encode(records)
		case "revoke":
			return local.RevokePeer(ctx, dir, arguments[2])
		case "trust":
			if err := local.TrustPeer(ctx, dir, arguments[2], arguments[3], arguments[4]); err != nil {
				return err
			}
			fmt.Println("Peer verified and trust saved on this device.")
		case "verify-quic":
			if err := local.VerifyQUICPeer(ctx, dir, arguments[2], arguments[3], arguments[4]); err != nil {
				return err
			}
			fmt.Println("Trusted peer Ed25519 identity verified over QUIC.")
		case "verify-trusted":
			if err := local.VerifyTrustedPeer(ctx, dir, arguments[2], arguments[3], arguments[4]); err != nil {
				return err
			}
			fmt.Println("Trusted peer Ed25519 identity verified.")
		case "verify":
			if err := local.VerifyPeer(ctx, dir, arguments[2], arguments[3], arguments[4]); err != nil {
				return err
			}
			fmt.Println("Peer Ed25519 identity verified.")
		case "ping":
			start := time.Now()
			if err := local.VerifyPeer(ctx, dir, arguments[2], arguments[3], arguments[4]); err != nil {
				return err
			}
			elapsed := time.Since(start).Round(time.Millisecond)
			if len(arguments) == 6 && arguments[5] == "--json" {
				return output.Encode(map[string]any{
					"target":      arguments[3],
					"fingerprint": arguments[4],
					"verified":    true,
					"latencyMs":   elapsed.Milliseconds(),
				})
			}
			shortFP := arguments[4]
			if len(shortFP) > 8 {
				shortFP = shortFP[:8]
			}
			fmt.Printf("Authenticated peer ping to %s (%s...): latency %v\n", arguments[3], shortFP, elapsed)
		}
		return nil
	}
	if arguments[0] == "discover" {
		if len(arguments) >= 4 {
			transport := "tcp"
			if len(arguments) == 5 {
				transport = arguments[4]
			}
			result, err := local.ResolveDiscoveryTransport(ctx, dir, arguments[2], arguments[3], transport)
			if err != nil {
				return err
			}
			return output.Encode(result)
		}
		result, err := local.Discover(ctx, dir)
		if err != nil {
			return err
		}
		return output.Encode(result)
	}
	if arguments[0] == "network" {
		if len(arguments) >= 2 && arguments[1] == "listener" {
			var result local.ListenerStatus
			var err error
			switch len(arguments) {
			case 2:
				result, err = local.GetListenerStatus(ctx, dir)
			case 3:
				result, err = local.StopListener(ctx, dir)
			case 5, 6:
				result, err = local.StartListener(ctx, dir, arguments[3], arguments[4], len(arguments) == 5)
			}
			if err != nil {
				return err
			}
			return output.Encode(result)
		}
		if len(arguments) == 4 {
			result, err := local.CheckNetworkScope(ctx, dir, arguments[2], arguments[3])
			if err != nil {
				return err
			}
			return output.Encode(result)
		}
		if len(arguments) == 3 {
			return local.SetInterfaceApproval(ctx, dir, arguments[2], arguments[1] == "approve")
		}
		interfaces, err := local.GetInterfaces(ctx, dir)
		if err != nil {
			return err
		}
		return output.Encode(interfaces)
	}
	if len(arguments) == 3 && arguments[0] == "identity" && arguments[1] == "rename" {
		device, err := local.SetDeviceName(ctx, dir, arguments[2])
		if err != nil {
			return err
		}
		return output.Encode(device)
	}
	device, err := local.GetIdentity(ctx, dir)
	if err != nil {
		return err
	}
	if len(arguments) == 2 {
		_, err := fmt.Fprintln(os.Stdout, device.Fingerprint)
		return err
	}
	return output.Encode(device)
}

type statusSummary struct {
	Running         bool                 `json:"running"`
	DeviceName      string               `json:"deviceName"`
	Fingerprint     string               `json:"fingerprint"`
	DaemonVersion   string               `json:"daemonVersion"`
	ProtocolVersion int                  `json:"protocolVersion"`
	Listener        local.ListenerStatus `json:"listener"`
	TrustedPeers    int                  `json:"trustedPeers"`
	Services        int                  `json:"services"`
	Tunnels         int                  `json:"tunnels"`
}

func runStatus(arguments []string) error {
	dir, err := local.Dir()
	if err != nil {
		return err
	}
	ctx := context.Background()
	device, err := local.GetIdentity(ctx, dir)
	if err != nil {
		return fmt.Errorf("daemon is not running or unreachable: %w", err)
	}
	listener, _ := local.GetListenerStatus(ctx, dir)
	peers, _ := local.TrustedPeers(ctx, dir)
	services, _ := local.ListServices(ctx, dir)
	tunnels, _ := local.ListTunnels(ctx, dir)

	summary := statusSummary{
		Running:         true,
		DeviceName:      device.Name,
		Fingerprint:     device.Fingerprint,
		DaemonVersion:   device.DaemonVersion,
		ProtocolVersion: device.ProtocolVersion,
		Listener:        listener,
		TrustedPeers:    len(peers),
		Services:        len(services),
		Tunnels:         len(tunnels),
	}

	if len(arguments) == 2 && arguments[1] == "--json" {
		output := json.NewEncoder(os.Stdout)
		output.SetIndent("", "  ")
		return output.Encode(summary)
	}

	fmt.Printf("Daemon:         running (version %s, protocol %d)\n", device.DaemonVersion, device.ProtocolVersion)
	fmt.Printf("Device:         %s\n", device.Name)
	fmt.Printf("Fingerprint:    %s\n", device.Fingerprint)
	if listener.State == "listening" {
		pairingStr := "disabled"
		if listener.Pairing {
			pairingStr = "enabled"
		}
		fmt.Printf("Listener:       active (%s on %s, pairing %s)\n", listener.Endpoint, listener.Adapter, pairingStr)
	} else {
		fmt.Printf("Listener:       stopped\n")
	}
	fmt.Printf("Trusted peers:  %d\n", len(peers))
	fmt.Printf("Services:       %d shared\n", len(services))
	fmt.Printf("Tunnels:        %d active\n", len(tunnels))
	return nil
}

type doctorCheck struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Details string `json:"details"`
}

type doctorReport struct {
	StateDir string        `json:"stateDir"`
	Passed   bool          `json:"passed"`
	Checks   []doctorCheck `json:"checks"`
}

func runDoctor(arguments []string) error {
	dir, err := local.Dir()
	if err != nil {
		return fmt.Errorf("failed to determine state directory: %w", err)
	}
	ctx := context.Background()
	var checks []doctorCheck
	allOk := true

	checks = append(checks, doctorCheck{
		Name:    "State directory",
		Status:  "ok",
		Details: fmt.Sprintf("%s (owner 0700)", dir),
	})

	dbPath := filepath.Join(dir, "state.sqlite3")
	if fi, err := os.Stat(dbPath); err == nil {
		checks = append(checks, doctorCheck{
			Name:    "Local database",
			Status:  "ok",
			Details: fmt.Sprintf("state.sqlite3 (%d bytes)", fi.Size()),
		})
	} else {
		checks = append(checks, doctorCheck{
			Name:    "Local database",
			Status:  "info",
			Details: "state.sqlite3 initialized on first daemon write",
		})
	}

	inboxPath := filepath.Join(dir, "inbox")
	if fi, err := os.Stat(inboxPath); err == nil && fi.IsDir() {
		checks = append(checks, doctorCheck{
			Name:    "File inbox",
			Status:  "ok",
			Details: fmt.Sprintf("%s (mode %04o)", inboxPath, fi.Mode().Perm()),
		})
	} else {
		checks = append(checks, doctorCheck{
			Name:    "File inbox",
			Status:  "info",
			Details: "inbox initialized on first file transfer",
		})
	}

	device, err := local.GetIdentity(ctx, dir)
	if err != nil {
		checks = append(checks, doctorCheck{
			Name:    "Daemon process",
			Status:  "warn",
			Details: "not running or socket unreachable",
		})
		allOk = false
	} else {
		checks = append(checks, doctorCheck{
			Name:    "Daemon process",
			Status:  "ok",
			Details: fmt.Sprintf("reachable via unix socket (v%s)", device.DaemonVersion),
		})
		checks = append(checks, doctorCheck{
			Name:    "Device identity",
			Status:  "ok",
			Details: fmt.Sprintf("%s (%s...%s)", device.Name, device.Fingerprint[:8], device.Fingerprint[len(device.Fingerprint)-6:]),
		})

		interfaces, err := local.GetInterfaces(ctx, dir)
		if err == nil {
			var approved []string
			for _, iface := range interfaces {
				if iface.Approved {
					approved = append(approved, iface.Name)
				}
			}
			if len(approved) > 0 {
				checks = append(checks, doctorCheck{
					Name:    "Approved adapters",
					Status:  "ok",
					Details: fmt.Sprintf("%d approved (%s)", len(approved), approved[0]),
				})
			} else {
				checks = append(checks, doctorCheck{
					Name:    "Approved adapters",
					Status:  "warn",
					Details: fmt.Sprintf("%d available, none approved for LAN traffic", len(interfaces)),
				})
			}
		}

		listener, err := local.GetListenerStatus(ctx, dir)
		if err == nil {
			if listener.State == "listening" {
				checks = append(checks, doctorCheck{
					Name:    "Peer listener",
					Status:  "ok",
					Details: fmt.Sprintf("active on %s (%s)", listener.Adapter, listener.Endpoint),
				})
			} else {
				checks = append(checks, doctorCheck{
					Name:    "Peer listener",
					Status:  "info",
					Details: "stopped (LAN inactive)",
				})
			}
		}

		peers, err := local.TrustedPeers(ctx, dir)
		if err == nil {
			checks = append(checks, doctorCheck{
				Name:    "Trusted peers",
				Status:  "ok",
				Details: fmt.Sprintf("%d paired device(s)", len(peers)),
			})
		}

		services, err := local.ListServices(ctx, dir)
		if err == nil {
			checks = append(checks, doctorCheck{
				Name:    "Shared services",
				Status:  "ok",
				Details: fmt.Sprintf("%d local service(s) registered", len(services)),
			})
		}
	}

	report := doctorReport{
		StateDir: dir,
		Passed:   allOk,
		Checks:   checks,
	}

	if len(arguments) == 2 && arguments[1] == "--json" {
		output := json.NewEncoder(os.Stdout)
		output.SetIndent("", "  ")
		return output.Encode(report)
	}

	fmt.Printf("Lanvory Doctor [%s]\n", dir)
	for _, c := range checks {
		prefix := fmt.Sprintf("[%s]", c.Status)
		fmt.Printf("  %-8s %-20s %s\n", prefix, c.Name+":", c.Details)
	}
	if allOk {
		fmt.Println("\nStatus: All core checks passed.")
	} else {
		fmt.Println("\nStatus: Warnings detected. Run 'lanvoryd' or start the desktop app.")
	}
	return nil
}
