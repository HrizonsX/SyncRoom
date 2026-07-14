# SyncRoom Media Extractor Service

Small internal service that normalizes yt-dlp extraction results for SyncRoom.

It is not a public web app. Deploy it on loopback or a private network and let
the SyncRoom server call it.

## How SyncRoom Uses It

The SyncRoom Node server owns provider routing, room membership, shared playback
state, cookies, proxy registration, and all permission checks. This Python
service only extracts playable media metadata for a single request and returns a
small JSON payload that SyncRoom maps into provider playback candidates.

Provider-specific SyncRoom adapters can pass request-scoped headers or cookies
when a platform needs them. The generic fallback provider should call this
service only for publicly reachable URLs and should not depend on stored login
state.

Keep this service independently deployable so yt-dlp can be upgraded or
restarted without changing the room server. Upgrading is normally just updating
`yt-dlp` in `requirements.txt`, reinstalling the service environment, and
restarting this process.

## Responsibilities

- Accept one URL per request.
- Use yt-dlp with `download=False`.
- Return normalized playback candidates for SyncRoom providers.
- Recognize direct/static `m3u8`, `mpd`, `mp4`, `flv`, and `ts`/`m2ts`
  media URLs when yt-dlp does not have a platform extractor.
- Treat headers and cookies as request-scoped input only.

## Non-goals

- Downloading media files.
- Persisting cookies or login state.
- Managing SyncRoom rooms, members, permissions, chat, or playback sync.
- Executing page JavaScript or browser automation.
- Handling DRM.

## Run

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python app.py
```

Linux systemd-style deployments can use the same entrypoint after creating a
venv:

```bash
MEDIA_EXTRACTOR_HOST=127.0.0.1 MEDIA_EXTRACTOR_PORT=8790 .venv/bin/python app.py
```

Environment:

- `MEDIA_EXTRACTOR_HOST`, default `127.0.0.1`
- `MEDIA_EXTRACTOR_PORT`, default `8790`

The SyncRoom server should point `MEDIA_EXTRACTOR_BASE_URL` at this service,
for example `http://127.0.0.1:8790`.

## API

`GET /health`

```json
{
  "ok": true,
  "engine": "yt-dlp",
  "version": "2026.06.23"
}
```

`POST /extract`

```json
{
  "url": "https://example.com/watch/123",
  "platform": "generic",
  "headers": {
    "Referer": "https://example.com/"
  }
}
```

Response:

```json
{
  "title": "Example",
  "sourceUrl": "https://example.com/watch/123",
  "isLive": false,
  "candidates": [
    {
      "id": "hls-720",
      "sourceType": "m3u8",
      "url": "https://cdn.example.com/index.m3u8",
      "qualityLabel": "720P"
    }
  ]
}
```
