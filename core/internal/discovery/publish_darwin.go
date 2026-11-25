//go:build darwin && cgo

package discovery

/*
#include <arpa/inet.h>
#include <dns_sd.h>
#include <errno.h>
#include <poll.h>
#include <stdlib.h>

typedef struct {
    DNSServiceRef ref;
    DNSServiceErrorType error;
    int ready;
} Publication;

static void published(DNSServiceRef ref, DNSServiceFlags flags, DNSServiceErrorType error,
        const char *name, const char *type, const char *domain, void *context) {
    Publication *pub = context;
    pub->error = error;
    pub->ready = error == kDNSServiceErr_NoError && (flags & kDNSServiceFlagsAdd);
}

static DNSServiceErrorType publish(Publication *pub, uint32_t index, const char *name, uint16_t port, int udp) {
    return DNSServiceRegister(&pub->ref, kDNSServiceFlagsNoAutoRename, index, name,
        udp ? "_lanvory._udp" : "_lanvory._tcp", "local.", NULL, htons(port), 0, NULL, published, pub);
}

static DNSServiceErrorType service_publication(Publication *pub) {
    struct pollfd fd = { .fd = DNSServiceRefSockFD(pub->ref), .events = POLLIN };
    if (fd.fd < 0) return kDNSServiceErr_Unknown;
    int ready = poll(&fd, 1, 100);
    if (ready == 0 || (ready < 0 && errno == EINTR)) return kDNSServiceErr_NoError;
    if (ready < 0 || !(fd.revents & POLLIN)) return kDNSServiceErr_Unknown;
    DNSServiceErrorType status = DNSServiceProcessResult(pub->ref);
    return status != kDNSServiceErr_NoError ? status : pub->error;
}
*/
import "C"

import (
	"context"
	"errors"
	"fmt"
	"time"
	"unsafe"
)

// Publish blocks until cancellation or loss of registration. The ready callback
// is called once after Bonjour confirms the registration.
const CanPublish = true

func Publish(ctx context.Context, index int, name string, port uint16, transport string, ready func()) error {
	if !usableIndex(index) || port == 0 || !ValidServiceName(name) || !ValidTransport(transport) {
		return errors.New("invalid Bonjour publication scope or service name")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	// The callback context is retained by Bonjour, so it must be C memory.
	pub := (*C.Publication)(C.calloc(1, C.sizeof_Publication))
	if pub == nil {
		return errors.New("allocate Bonjour publication")
	}
	defer C.free(unsafe.Pointer(pub))
	label := C.CString(name)
	defer C.free(unsafe.Pointer(label))

	udp := C.int(0)
	if transport == "udp" {
		udp = 1
	}
	if status := C.publish(pub, C.uint32_t(index), label, C.uint16_t(port), udp); status != 0 {
		return fmt.Errorf("register Bonjour service: status %d", status)
	}
	defer C.DNSServiceRefDeallocate(pub.ref)
	deadline := time.Now().Add(3 * time.Second)
	confirmed := false
	for ctx.Err() == nil {
		if status := C.service_publication(pub); status != 0 {
			return fmt.Errorf("maintain Bonjour publication: status %d", status)
		}
		if pub.ready != 0 && !confirmed {
			ready()
			confirmed = true
		}
		if !confirmed && time.Now().After(deadline) {
			return errors.New("Bonjour registration timed out")
		}
		if confirmed && pub.ready == 0 {
			return errors.New("Bonjour withdrew the registration")
		}
	}
	return nil
}
