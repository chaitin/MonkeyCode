//go:build !linux && !darwin

package relay

func controlPeerAllowed(int) bool { return false }
