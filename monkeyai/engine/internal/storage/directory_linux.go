package storage

import "golang.org/x/sys/unix"

func prepareRuntime(path string) error {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	if err := unix.Fchown(fd, 0, 0); err != nil {
		return err
	}
	return unix.Fchmod(fd, 0755)
}

func prepareRuntimeLock(path string) error {
	fd, err := unix.Open(path, unix.O_RDWR|unix.O_CREAT|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	var info unix.Stat_t
	if err := unix.Fstat(fd, &info); err != nil {
		return err
	}
	if info.Mode&unix.S_IFMT != unix.S_IFREG || info.Size != 0 {
		return unix.EINVAL
	}
	if err := unix.Fchown(fd, 1000, 1000); err != nil {
		return err
	}
	return unix.Fchmod(fd, 0600)
}

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
