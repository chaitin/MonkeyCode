package relay

import "golang.org/x/sys/unix"

func controlPeerAllowed(fd int) bool {
	cred, err := unix.GetsockoptXucred(fd, unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	return err == nil && cred.Uid == uint32(unix.Geteuid())
}
