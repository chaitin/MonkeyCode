package relay

import "golang.org/x/sys/unix"

func controlPeerAllowed(fd int) bool {
	cred, err := unix.GetsockoptUcred(fd, unix.SOL_SOCKET, unix.SO_PEERCRED)
	return err == nil && cred.Uid == uint32(unix.Geteuid())
}
