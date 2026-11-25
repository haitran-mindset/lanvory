package storage

type TransferHistory struct {
	dir   string
	owner string
}

func NewTransferHistory(dir, owner string) TransferHistory {
	return TransferHistory{dir: dir, owner: owner}
}
