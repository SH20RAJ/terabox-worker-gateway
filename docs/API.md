# API Reference

All responses are JSON unless a proxy mode returns upstream content such as HTML, playlists, or media segments.

## CORS

The Worker adds:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

## `GET /`

Returns service metadata and available endpoints.

Example:

```bash
curl https://your-worker.example.workers.dev/
```

## `GET /health`

Returns a lightweight health response.

Response:

```json
{
  "status": "healthy",
  "timestamp": "2026-05-24T00:00:00.000Z"
}
```

## `GET /api?url=...`

Fetches file metadata for a TeraBox share URL.

Query parameters:

| Name | Required | Description |
| --- | --- | --- |
| `url` | Yes | TeraBox share URL. |
| `pwd` | No | Password for protected shares. |

Example:

```bash
curl "https://your-worker.example.workers.dev/api?url=https://teraboxshare.com/s/1EXAMPLE"
```

Success response:

```json
{
  "status": "success",
  "url": "https://teraboxshare.com/s/1EXAMPLE",
  "files": [
    {
      "filename": "example.mp4",
      "size": "10.00 MB",
      "size_bytes": 10485760,
      "download_link": "https://...",
      "is_directory": false,
      "thumbnails": {},
      "path": "/example.mp4",
      "fs_id": "123"
    }
  ],
  "total_files": 1,
  "response_time": "0.123s",
  "timestamp": "2026-05-24T00:00:00.000Z"
}
```

## `GET /api?mode=...`

Passes supported proxy modes through to the configured `PROXY_BASE_URL`.

Supported modes:

| Mode | Required parameters | Description |
| --- | --- | --- |
| `resolve` | `surl` | Resolve a short share ID and return metadata. |
| `page` | `surl` | Return the upstream share page. |
| `api` | `jsToken`, `shorturl` | Call the upstream share API. |
| `stream` | `surl` | Return an HLS playlist when supported by the upstream proxy. |
| `segment` | `url` | Proxy a media segment URL. |

Examples:

```bash
curl "https://your-worker.example.workers.dev/api?mode=resolve&surl=EXAMPLE"
curl "https://your-worker.example.workers.dev/api?mode=stream&surl=EXAMPLE"
```

## `GET /api2?url=...`

Fetches metadata and attempts to resolve direct download links with `HEAD` requests.

Query parameters:

| Name | Required | Description |
| --- | --- | --- |
| `url` | Yes | TeraBox share URL. |
| `pwd` | No | Password for protected shares. |

Example:

```bash
curl "https://your-worker.example.workers.dev/api2?url=https://teraboxshare.com/s/1EXAMPLE"
```

## `GET /v1/echo`

Debug endpoint that echoes query parameters and selected request headers.

Example:

```bash
curl "https://your-worker.example.workers.dev/v1/echo?hello=world"
```

## Error Shape

Common error responses use:

```json
{
  "status": "error",
  "message": "Error description"
}
```

Proxy-specific failures may use:

```json
{
  "error": "Proxy request failed",
  "status_code": 502,
  "details": {}
}
```
