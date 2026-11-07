package storage

import "golang.org/x/sys/unix"

func prepare(path string) error {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	if err := unix.Fchown(fd, 1000, 1000); err != nil {
		return err
	}
	return unix.Fchmod(fd, 0700)
}
