//go:build darwin && cgo

package discovery

/*
#include <arpa/inet.h>
#include <dns_sd.h>
#include <errno.h>
#include <poll.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>

enum { max_addresses = 8, phase_ms = 850 };
typedef struct {
    uint32_t index;
    DNSServiceErrorType error;
    uint16_t port;
    char target[254];
    uint8_t addresses[max_addresses][4];
    int count;
} Resolution;

static int local_hostname(const char *host) {
    if (!host) return 0;
    size_t len = strlen(host);
    if (len <= 7 || len >= sizeof(((Resolution *)0)->target) || strcasecmp(host + len - 7, ".local.")) return 0;
    int label = 0;
    for (size_t i = 0; i < len; i++) {
        char ch = host[i];
        if (ch == '.') {
            if (label == 0 || label > 63) return 0;
            label = 0;
        } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                   (ch >= '0' && ch <= '9') || ch == '-') {
            label++;
        } else return 0;
    }
    return 1;
}

static void on_resolve(DNSServiceRef ref, DNSServiceFlags flags, uint32_t index,
        DNSServiceErrorType error, const char *fullname, const char *target,
        uint16_t port, uint16_t txtlen, const unsigned char *txt, void *context) {
    Resolution *result = context;
    if (error != 0) { result->error = error; return; }
    if (index != result->index || !port || !local_hostname(target) || result->port != 0) return;
    strcpy(result->target, target);
    result->port = ntohs(port);
}

static void on_address(DNSServiceRef ref, DNSServiceFlags flags, uint32_t index,
        DNSServiceErrorType error, const char *name, uint16_t type, uint16_t rrclass,
        uint16_t length, const void *data, uint32_t ttl, void *context) {
    Resolution *result = context;
    if (error != 0) { result->error = error; return; }
    if (index != result->index || !name || strcasecmp(name, result->target) ||
        type != kDNSServiceType_A || rrclass != kDNSServiceClass_IN || length != 4 || !data) return;

    int slot = 0;
    while (slot < result->count && memcmp(result->addresses[slot], data, 4) != 0) slot++;
    if (flags & kDNSServiceFlagsAdd) {
        if (slot == result->count && slot < max_addresses) {
            memcpy(result->addresses[result->count++], data, 4);
        }
    } else if (slot < result->count) {
        result->count--;
        if (slot != result->count) memcpy(result->addresses[slot], result->addresses[result->count], 4);
    }
}

static DNSServiceErrorType process(DNSServiceRef ref, Resolution *result, int srv_phase) {
    struct pollfd fd = { .fd = DNSServiceRefSockFD(ref), .events = POLLIN };
    if (fd.fd < 0) return kDNSServiceErr_Unknown;
    uint64_t deadline = clock_gettime_nsec_np(CLOCK_MONOTONIC) + (uint64_t)phase_ms * 1000000;
    while (!srv_phase || result->port == 0) {
        uint64_t now = clock_gettime_nsec_np(CLOCK_MONOTONIC);
        if (now >= deadline) break;
        int ready = poll(&fd, 1, (int)((deadline - now + 999999) / 1000000));
        if (ready == 0) break;
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0 || !(fd.revents & POLLIN)) return kDNSServiceErr_Unknown;
        DNSServiceErrorType status = DNSServiceProcessResult(ref);
        if (status != 0) return status;
        if (result->error != 0) return result->error;
    }
    return kDNSServiceErr_NoError;
}

static DNSServiceErrorType resolve_service(uint32_t index, const char *name, int udp, Resolution *result) {
    if (index == 0 || index >= UINT32_MAX - 4) return kDNSServiceErr_BadParam;
    result->index = index;
    DNSServiceRef ref;
    DNSServiceErrorType status = DNSServiceResolve(&ref, kDNSServiceFlagsForceMulticast, index,
        name, udp ? "_lanvory._udp" : "_lanvory._tcp", "local.", on_resolve, result);
    if (status != 0) return status;
    status = process(ref, result, 1);
    DNSServiceRefDeallocate(ref);
    if (status != 0 || !result->port) return status;

    status = DNSServiceQueryRecord(&ref, kDNSServiceFlagsForceMulticast, index, result->target,
        kDNSServiceType_A, kDNSServiceClass_IN, on_address, result);
    if (status != 0) return status;
    status = process(ref, result, 0);
    DNSServiceRefDeallocate(ref);
    return status;
}
*/
import "C"

import (
	"fmt"
	"net/netip"
	"unsafe"
)

func resolveInterface(index int, name, transport string) (uint16, []netip.Addr, error) {
	label := C.CString(name)
	defer C.free(unsafe.Pointer(label))
	var result C.Resolution
	udp := C.int(0)
	if transport == "udp" {
		udp = 1
	}
	status := C.resolve_service(C.uint32_t(index), label, udp, &result)
	if status == C.kDNSServiceErr_NoSuchName || status == C.kDNSServiceErr_NoSuchRecord || (status == 0 && result.port == 0) {
		return 0, nil, ErrServiceNotFound
	}
	if status != 0 {
		return 0, nil, fmt.Errorf("resolve Bonjour service: status %d", status)
	}
	addresses := make([]netip.Addr, 0, int(result.count))
	for i := 0; i < int(result.count); i++ {
		bytes := result.addresses[i]
		addresses = append(addresses, netip.AddrFrom4([4]byte{byte(bytes[0]), byte(bytes[1]), byte(bytes[2]), byte(bytes[3])}))
	}
	return uint16(result.port), addresses, nil
}
