//go:build darwin && cgo

package discovery

/*
#include <dns_sd.h>
#include <errno.h>
#include <poll.h>
#include <stdint.h>
#include <string.h>
#include <strings.h>
#include <time.h>

enum { capacity = 8, name_size = 64, window_ms = 750 };
typedef struct {
    uint32_t index;
    DNSServiceErrorType error;
    int count;
    int truncated;
    char names[capacity][name_size];
} Snapshot;

static void on_browse(DNSServiceRef ref, DNSServiceFlags flags, uint32_t index,
    DNSServiceErrorType error, const char *name, const char *type,
    const char *domain, void *context) {
    Snapshot *snapshot = context;
    if (error != kDNSServiceErr_NoError) {
        snapshot->error = error;
        return;
    }
    if (index != snapshot->index || !domain || strcasecmp(domain, "local.") != 0 ||
        !name || !*name || strlen(name) >= name_size) return;

    int slot = 0;
    for (; slot < snapshot->count; slot++) {
        if (strcmp(snapshot->names[slot], name) == 0) break;
    }
    if (flags & kDNSServiceFlagsAdd) {
        if (slot < snapshot->count) return;
        if (snapshot->count == capacity) {
            snapshot->truncated = 1;
            return;
        }
        memcpy(snapshot->names[snapshot->count++], name, strlen(name) + 1);
    } else if (slot < snapshot->count) {
        snapshot->count--;
        if (slot != snapshot->count) {
            memcpy(snapshot->names[slot], snapshot->names[snapshot->count], name_size);
        }
    }
}

static DNSServiceErrorType take_snapshot(uint32_t index, int tcp, Snapshot *snapshot) {
    if (index == 0 || index >= UINT32_MAX - 4) return kDNSServiceErr_BadParam;
    snapshot->index = index;
    DNSServiceRef ref;
    DNSServiceErrorType status = DNSServiceBrowse(&ref, 0, index,
        tcp ? "_lanvory._tcp" : "_lanvory._udp", "local.", on_browse, snapshot);
    if (status != kDNSServiceErr_NoError) return status;
    struct pollfd fd = { .fd = DNSServiceRefSockFD(ref), .events = POLLIN };
    uint64_t deadline = clock_gettime_nsec_np(CLOCK_MONOTONIC) + (uint64_t)window_ms * 1000000;
    for (;;) {
        uint64_t now = clock_gettime_nsec_np(CLOCK_MONOTONIC);
        if (now >= deadline) break;
        int remaining = (int)((deadline - now + 999999) / 1000000);
        int ready = poll(&fd, 1, remaining);
        if (ready == 0) break;
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0 || !(fd.revents & POLLIN)) {
            status = kDNSServiceErr_Unknown;
            break;
        }
        status = DNSServiceProcessResult(ref);
        if (status != kDNSServiceErr_NoError || snapshot->error != kDNSServiceErr_NoError) break;
    }
    DNSServiceRefDeallocate(ref);
    return status != kDNSServiceErr_NoError ? status : snapshot->error;
}
*/
import "C"

import (
	"fmt"
)

func browseInterface(index int) ([]instance, bool, error) {
	tcp, tcpTruncated, err := browseTransport(index, 1, "tcp")
	if err != nil {
		return nil, false, err
	}
	udp, udpTruncated, err := browseTransport(index, 0, "udp")
	if err != nil {
		return nil, false, err
	}
	return append(tcp, udp...), tcpTruncated || udpTruncated, nil
}

func browseTransport(index int, tcp C.int, transport string) ([]instance, bool, error) {
	var snapshot C.Snapshot
	if status := C.take_snapshot(C.uint32_t(index), tcp, &snapshot); status != C.kDNSServiceErr_NoError {
		return nil, false, fmt.Errorf("Bonjour status %d", status)
	}
	names := make([]instance, 0, int(snapshot.count))
	for i := 0; i < int(snapshot.count); i++ {
		name := C.GoString(&snapshot.names[i][0])
		if !ValidServiceName(name) {
			continue
		}
		names = append(names, instance{name, transport})
	}
	return names, snapshot.truncated != 0, nil
}
