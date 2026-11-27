package mount

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
)

// Entry represents a remote file or directory returned by PROPFIND.
type Entry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDir       bool   `json:"isDir"`
	Size        int64  `json:"size"`
	ModifiedAt  string `json:"modifiedAt,omitempty"`
	ETag        string `json:"etag,omitempty"`
	ContentType string `json:"contentType,omitempty"`
}

// RangeChunk is a single streamed byte window with ETag metadata.
type RangeChunk struct {
	Data      []byte
	Offset    int64
	TotalSize int64
	ETag      string
	FromCache bool
}

type cachedBlock struct {
	key       string
	data      []byte
	totalSize int64
	etag      string
}

// StreamCache is a bounded in-memory read-ahead cache (no disk persistence required).
type StreamCache struct {
	mu       sync.Mutex
	maxBytes int
	curBytes int
	order    []string
	blocks   map[string]cachedBlock
}

// NewStreamCache creates a bounded memory buffer for adaptive read-ahead.
func NewStreamCache(maxBytes int) *StreamCache {
	if maxBytes <= 0 {
		maxBytes = 8 * 1024 * 1024 // 8 MiB bounded memory buffer
	}
	return &StreamCache{
		maxBytes: maxBytes,
		blocks:   make(map[string]cachedBlock),
	}
}

func (c *StreamCache) get(key string, expectedETag string) (cachedBlock, bool) {
	if c == nil {
		return cachedBlock{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	blk, ok := c.blocks[key]
	if !ok {
		return cachedBlock{}, false
	}
	if expectedETag != "" && blk.etag != "" && blk.etag != expectedETag {
		delete(c.blocks, key)
		c.curBytes -= len(blk.data)
		return cachedBlock{}, false
	}
	return blk, true
}

func (c *StreamCache) put(blk cachedBlock) {
	if c == nil || len(blk.data) > c.maxBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if old, exists := c.blocks[blk.key]; exists {
		c.curBytes -= len(old.data)
	}
	for c.curBytes+len(blk.data) > c.maxBytes && len(c.order) > 0 {
		evictKey := c.order[0]
		c.order = c.order[1:]
		if old, ok := c.blocks[evictKey]; ok {
			c.curBytes -= len(old.data)
			delete(c.blocks, evictKey)
		}
	}
	c.blocks[blk.key] = blk
	c.curBytes += len(blk.data)
	c.order = append(c.order, blk.key)
}

// InvalidatePath removes all cached byte ranges for a given remote file path.
func (c *StreamCache) InvalidatePath(baseURL, filePath string) {
	if c == nil {
		return
	}
	prefix := fmt.Sprintf("%s|%s|", baseURL, filePath)
	c.mu.Lock()
	defer c.mu.Unlock()
	for k, blk := range c.blocks {
		if strings.HasPrefix(k, prefix) {
			c.curBytes -= len(blk.data)
			delete(c.blocks, k)
		}
	}
}

// ListDirectory queries a WebDAV endpoint with PROPFIND Depth: 1 and returns entries.
func ListDirectory(ctx context.Context, client *http.Client, baseURL, subPath string) ([]Entry, error) {
	if client == nil {
		client = http.DefaultClient
	}
	targetURL := joinWebDAVURL(baseURL, subPath)
	if !strings.HasSuffix(targetURL, "/") {
		targetURL += "/"
	}
	req, err := http.NewRequestWithContext(ctx, "PROPFIND", targetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Depth", "1")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMultiStatus && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("PROPFIND %s: status %d (%s)", subPath, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	type propXML struct {
		DisplayName      string `xml:"displayname"`
		GetContentLength int64  `xml:"getcontentlength"`
		GetLastModified  string `xml:"getlastmodified"`
		GetETag          string `xml:"getetag"`
		GetContentType   string `xml:"getcontenttype"`
		ResourceType     struct {
			Collection *struct{} `xml:"collection"`
		} `xml:"resourcetype"`
	}
	type responseXML struct {
		Href     string `xml:"href"`
		PropStat struct {
			Prop propXML `xml:"prop"`
		} `xml:"propstat"`
	}
	type multistatusXML struct {
		Responses []responseXML `xml:"response"`
	}

	var ms multistatusXML
	if err := xml.NewDecoder(io.LimitReader(resp.Body, 4*1024*1024)).Decode(&ms); err != nil {
		return nil, err
	}

	cleanedBase := path.Clean("/" + strings.TrimPrefix(subPath, "/"))
	entries := make([]Entry, 0, len(ms.Responses))
	for _, item := range ms.Responses {
		u, err := url.Parse(item.Href)
		hrefPath := item.Href
		if err == nil && u.Path != "" {
			hrefPath = u.Path
		}
		cleanedHref := path.Clean("/" + strings.TrimPrefix(hrefPath, "/"))
		if cleanedHref == cleanedBase {
			continue
		}
		name := item.PropStat.Prop.DisplayName
		if name == "" {
			name = path.Base(cleanedHref)
		}
		entries = append(entries, Entry{
			Name:        name,
			Path:        cleanedHref,
			IsDir:       item.PropStat.Prop.ResourceType.Collection != nil,
			Size:        item.PropStat.Prop.GetContentLength,
			ModifiedAt:  item.PropStat.Prop.GetLastModified,
			ETag:        strings.Trim(item.PropStat.Prop.GetETag, "\""),
			ContentType: item.PropStat.Prop.GetContentType,
		})
	}
	return entries, nil
}

// ReadRange fetches a byte window using HTTP Range + ETag validation + optional adaptive read-ahead.
func ReadRange(
	ctx context.Context,
	client *http.Client,
	cache *StreamCache,
	baseURL, filePath string,
	offset, length int64,
	expectedETag string,
) (RangeChunk, error) {
	if client == nil {
		client = http.DefaultClient
	}
	if offset < 0 {
		offset = 0
	}
	if length <= 0 || length > 2*1024*1024 {
		length = 64 * 1024
	}
	cacheKey := fmt.Sprintf("%s|%s|%d|%d", baseURL, filePath, offset, length)
	if blk, ok := cache.get(cacheKey, expectedETag); ok {
		return RangeChunk{
			Data:      blk.data,
			Offset:    offset,
			TotalSize: blk.totalSize,
			ETag:      blk.etag,
			FromCache: true,
		}, nil
	}

	targetURL := joinWebDAVURL(baseURL, filePath)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return RangeChunk{}, err
	}
	// Adaptive read-ahead: fetch up to 2x window (capped at 512 KiB) when reading sequentially.
	fetchLen := length
	if cache != nil && fetchLen < 256*1024 {
		fetchLen = min(length*2, 512*1024)
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", offset, offset+fetchLen-1))
	if expectedETag != "" {
		req.Header.Set("If-Range", expectedETag)
	}

	resp, err := client.Do(req)
	if err != nil {
		return RangeChunk{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusPartialContent && resp.StatusCode != http.StatusOK {
		return RangeChunk{}, fmt.Errorf("GET %s: status %d", filePath, resp.StatusCode)
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, fetchLen+1024))
	if err != nil {
		return RangeChunk{}, err
	}
	etag := strings.Trim(resp.Header.Get("ETag"), "\"")
	totalSize := parseTotalFromContentRange(resp.Header.Get("Content-Range"), int64(len(raw)))

	if cache != nil && len(raw) > 0 {
		cache.put(cachedBlock{
			key:       cacheKey,
			data:      raw[:min(int64(len(raw)), length)],
			totalSize: totalSize,
			etag:      etag,
		})
		if int64(len(raw)) > length {
			nextKey := fmt.Sprintf("%s|%s|%d|%d", baseURL, filePath, offset+length, length)
			cache.put(cachedBlock{
				key:       nextKey,
				data:      raw[length:],
				totalSize: totalSize,
				etag:      etag,
			})
		}
	}

	out := raw
	if int64(len(out)) > length {
		out = out[:length]
	}
	return RangeChunk{
		Data:      out,
		Offset:    offset,
		TotalSize: totalSize,
		ETag:      etag,
	}, nil
}

// CreateDir creates a remote directory via WebDAV MKCOL.
func CreateDir(ctx context.Context, client *http.Client, baseURL, dirPath string) error {
	return doSimpleDAV(ctx, client, "MKCOL", baseURL, dirPath, nil, nil)
}

// WriteFile writes or replaces a remote file via WebDAV PUT.
func WriteFile(ctx context.Context, client *http.Client, baseURL, filePath string, data []byte) error {
	return doSimpleDAV(ctx, client, http.MethodPut, baseURL, filePath, bytes.NewReader(data), nil)
}

// DeletePath deletes a remote file or empty directory via WebDAV DELETE.
func DeletePath(ctx context.Context, client *http.Client, baseURL, targetPath string) error {
	return doSimpleDAV(ctx, client, http.MethodDelete, baseURL, targetPath, nil, nil)
}

// RenamePath renames or moves a remote file/directory via WebDAV MOVE.
func RenamePath(ctx context.Context, client *http.Client, baseURL, srcPath, dstPath string) error {
	dstURL := joinWebDAVURL(baseURL, dstPath)
	return doSimpleDAV(ctx, client, "MOVE", baseURL, srcPath, nil, map[string]string{
		"Destination": dstURL,
		"Overwrite":   "F",
	})
}

func doSimpleDAV(ctx context.Context, client *http.Client, method, baseURL, relPath string, body io.Reader, headers map[string]string) error {
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, method, joinWebDAVURL(baseURL, relPath), body)
	if err != nil {
		return err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return errors.New(strings.TrimSpace(string(msg)))
	}
	return nil
}

func joinWebDAVURL(baseURL, relPath string) string {
	base := strings.TrimRight(baseURL, "/")
	cleaned := path.Clean("/" + strings.TrimPrefix(relPath, "/"))
	if cleaned == "/" {
		return base + "/"
	}
	segments := strings.Split(strings.TrimPrefix(cleaned, "/"), "/")
	for i, s := range segments {
		segments[i] = url.PathEscape(s)
	}
	return base + "/" + strings.Join(segments, "/")
}

func parseTotalFromContentRange(header string, fallback int64) int64 {
	idx := strings.LastIndex(header, "/")
	if idx < 0 {
		return fallback
	}
	if total, err := strconv.ParseInt(strings.TrimSpace(header[idx+1:]), 10, 64); err == nil {
		return total
	}
	return fallback
}
