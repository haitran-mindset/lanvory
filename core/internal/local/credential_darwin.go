//go:build darwin && cgo

package local

/*
#include <sys/types.h>
#include <unistd.h>

static int sameUser(int fd, uid_t expected) {
    uid_t uid;
    gid_t gid;
    return getpeereid(fd, &uid, &gid) == 0 && uid == expected;
}
*/
import "C"

func matchesPeerUID(fd uintptr, uid uint32) bool {
	return C.sameUser(C.int(fd), C.uid_t(uid)) != 0
}
