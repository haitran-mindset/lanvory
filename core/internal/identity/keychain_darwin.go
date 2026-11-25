//go:build darwin && cgo

package identity

/*
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <Security/Security.h>
#include <stdlib.h>

static CFMutableDictionaryRef query(const char *account) {
    CFMutableDictionaryRef attributes = CFDictionaryCreateMutable(NULL, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFStringRef name = CFStringCreateWithCString(NULL, account, kCFStringEncodingUTF8);
    CFDictionarySetValue(attributes, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(attributes, kSecAttrService, CFSTR("local.lanvory.identity.v1"));
    CFDictionarySetValue(attributes, kSecAttrAccount, name);
    CFRelease(name);
    return attributes;
}

static OSStatus readSeed(const char *account, void *seed, UInt32 length) {
    CFMutableDictionaryRef attributes = query(account);
    CFDictionarySetValue(attributes, kSecReturnData, kCFBooleanTrue);
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching(attributes, &result);
    CFRelease(attributes);
    if (status != errSecSuccess) return status;
    if (result != NULL && CFGetTypeID(result) == CFDataGetTypeID()
        && CFDataGetLength((CFDataRef)result) == length) {
        CFDataGetBytes((CFDataRef)result, CFRangeMake(0, length), seed);
    } else {
        status = errSecDecode;
    }
    if (result != NULL) CFRelease(result);
    return status;
}

static OSStatus writeSeed(const char *account, const void *seed, UInt32 length) {
    CFMutableDictionaryRef attributes = query(account);
    CFDataRef data = CFDataCreateWithBytesNoCopy(NULL, seed, length, kCFAllocatorNull);
    CFDictionarySetValue(attributes, kSecValueData, data);
    OSStatus status = SecItemAdd(attributes, NULL);
    CFRelease(data);
    CFRelease(attributes);
    return status;
}
*/
import "C"

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"unsafe"
)

func Load(account string) (ed25519.PrivateKey, error) {
	name := C.CString(account)
	defer C.free(unsafe.Pointer(name))
	seed := make([]byte, ed25519.SeedSize)
	defer clear(seed)
	ptr := unsafe.Pointer(&seed[0])
	size := C.UInt32(len(seed))
	status := C.readSeed(name, ptr, size)
	if status == C.errSecItemNotFound {
		if _, err := rand.Read(seed); err != nil {
			return nil, err
		}
		status = C.writeSeed(name, ptr, size)
		if status == C.errSecDuplicateItem {
			status = C.readSeed(name, ptr, size)
		}
	}
	if status != C.errSecSuccess {
		return nil, fmt.Errorf("macOS Keychain returned status %d", int(status))
	}
	return ed25519.NewKeyFromSeed(seed), nil
}
