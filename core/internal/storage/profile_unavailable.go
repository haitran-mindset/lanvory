//go:build (!darwin && !linux) || !cgo

package storage

import "errors"

func LoadProfile(string, string, string) (Profile, error) {
	return Profile{}, errors.New("this build has no supported SQLite integration")
}

func RenameProfile(string, string, string) error {
	return errors.New("this build has no supported SQLite integration")
}

func InterfaceApprovals(string) (map[string]string, error) {
	return nil, errors.New("this build has no supported SQLite integration")
}

func SetInterfaceApproval(string, string, string) error {
	return errors.New("this build has no supported SQLite integration")
}

func TrustedPeers(string, string) ([]TrustedPeer, error) {
	return nil, errors.New("this build has no supported SQLite integration")
}

func SetPeerTrust(string, string, string, bool) error {
	return errors.New("this build has no supported SQLite integration")
}

func IsTrustedPeer(string, string, string) (bool, error) {
	return false, errors.New("this build has no supported SQLite integration")
}
