package permissions

import "regexp"

const ReceiveFile = "file-receive"
const ConnectService = "service-connect"
const ClipboardShare = "clipboard-share"
const FolderSync = "folder-sync"

var resourceName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

func ValidResource(capability, resource string) bool {
	switch capability {
	case ReceiveFile, ConnectService, ClipboardShare, FolderSync:
		return resourceName.MatchString(resource)
	default:
		return false
	}
}
