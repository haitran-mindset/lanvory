//go:build darwin && !cgo

package local

func matchesPeerUID(uintptr, uint32) bool { return false }
