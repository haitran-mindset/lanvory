//go:build linux && cgo

package identity

/*
#cgo pkg-config: libsecret-1
#include <libsecret/secret.h>
#include <stdlib.h>
#include <string.h>

static const SecretSchema schema = {
    .name = "local.lanvory.identity.v1",
    .attributes = {{"account", SECRET_SCHEMA_ATTRIBUTE_STRING}, {NULL, 0}},
};

enum { SEED_FOUND, SEED_MISSING, SEED_INVALID, STORE_UNAVAILABLE };

static GHashTable *identityAttributes(const char *account) {
    return secret_attributes_build(&schema, "account", account, NULL);
}

static int readSeed(GHashTable *attributes, void *seed, size_t length) {
    GError *error = NULL;
    GList *items = secret_service_search_sync(NULL, &schema, attributes,
        SECRET_SEARCH_ALL | SECRET_SEARCH_UNLOCK | SECRET_SEARCH_LOAD_SECRETS, NULL, &error);
    int status = SEED_INVALID;
    if (error != NULL) {
        g_error_free(error);
        status = STORE_UNAVAILABLE;
    } else if (items == NULL) {
        status = SEED_MISSING;
    } else if (items->next == NULL) {
        SecretValue *value = secret_item_get_secret(items->data);
        if (value != NULL) {
            gsize size = 0;
            const gchar *bytes = secret_value_get(value, &size);
            if (size == length) {
                memcpy(seed, bytes, length);
                status = SEED_FOUND;
            }
            secret_value_unref(value);
        }
    }
    g_list_free_full(items, g_object_unref);
    return status;
}

static gboolean writeSeed(GHashTable *attributes, const void *seed, size_t length) {
    SecretValue *value = secret_value_new(seed, length, "application/octet-stream");
    gboolean stored = secret_service_store_sync(NULL, &schema, attributes,
        SECRET_COLLECTION_DEFAULT, "Lanvory device identity", value, NULL, NULL);
    secret_value_unref(value);
    return stored;
}
*/
import "C"

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf8"
	"unsafe"
)

func Load(account string) (ed25519.PrivateKey, error) {
	if account == "" || strings.ContainsRune(account, 0) || !utf8.ValidString(account) {
		return nil, errors.New("invalid identity account")
	}
	lock, err := lockCredentialStore()
	if err != nil {
		return nil, fmt.Errorf("lock Linux credential store initialization: %w", err)
	}
	defer lock.Close()

	name := C.CString(account)
	defer C.free(unsafe.Pointer(name))
	attributes := C.identityAttributes(name)
	if attributes == nil {
		return nil, errors.New("could not prepare Linux Secret Service identity lookup")
	}
	defer C.g_hash_table_unref(attributes)

	seed := make([]byte, ed25519.SeedSize)
	defer clear(seed)
	ptr := unsafe.Pointer(&seed[0])
	size := C.size_t(len(seed))
	switch C.readSeed(attributes, ptr, size) {
	case C.SEED_FOUND:
	case C.SEED_MISSING:
		if _, err := rand.Read(seed); err != nil {
			return nil, err
		}
		if C.writeSeed(attributes, ptr, size) == 0 {
			return nil, errors.New("could not store device identity in Linux Secret Service")
		}
	case C.SEED_INVALID:
		return nil, errors.New("Linux Secret Service device identity is locked, duplicated, or invalid")
	default:
		return nil, errors.New("Linux Secret Service is unavailable")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

// Serialize lookup and first write even when daemons use different state directories.
func lockCredentialStore() (*os.File, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(cache, "lanvory", "identity")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(dir, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	var stat syscall.Stat_t
	if err := syscall.Fstat(int(lock.Fd()), &stat); err != nil {
		lock.Close()
		return nil, err
	}
	if stat.Uid != uint32(os.Geteuid()) || stat.Mode&0077 != 0 {
		lock.Close()
		return nil, errors.New("identity lock directory must be private and owned by the current user")
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, err
	}
	return lock, nil
}
