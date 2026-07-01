from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import base64
import hashlib
import html
import json
import os
import re
import sys
import time
from typing import Any, Callable
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

try:
    import yt_dlp
except Exception:  # pragma: no cover - service can still report unavailable.
    yt_dlp = None


JsonObject = dict[str, Any]
ExtractFn = Callable[[str, dict[str, str]], JsonObject]
IqiyiExtractFn = Callable[[str, dict[str, str]], JsonObject]
StaticExtractFn = Callable[[str, dict[str, str]], JsonObject]


DEFAULT_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/149.0.0.0 Safari/537.36"
)

IQIYI_TVID_MASK = 0x75706971676C


class ExtractorHttpError(Exception):
    def __init__(self, status: int, error: str, message: str):
        self.status = status
        self.message = json.dumps({"error": error, "message": message})
        super().__init__(self.message)


def build_health(version: str | None = None) -> JsonObject:
    return {
        "ok": True,
        "engine": "yt-dlp",
        "version": version or get_ytdlp_version(),
    }


def get_ytdlp_version() -> str:
    if yt_dlp is None:
        return "unavailable"
    version = getattr(yt_dlp, "version", None)
    return str(getattr(version, "__version__", "unknown"))


def is_http_url(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    parsed = urlparse(value.strip())
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def normalize_input_url(value: str) -> str:
    return html.unescape(value).strip()


def is_iqiyi_page_url(value: str) -> bool:
    parsed = urlparse(value)
    hostname = parsed.hostname or ""
    return (
        (hostname == "iqiyi.com" or hostname.endswith(".iqiyi.com") or hostname == "www.pps.tv")
        and re.search(r"/[vwp]_[^/?#]+\.html$", parsed.path) is not None
    )


def decode_iqiyi_path_token(token: str) -> int | None:
    try:
        encoded_bits = bin(int(token, 36))[2:][::-1]
    except ValueError:
        return None
    mask_bits = bin(IQIYI_TVID_MASK)[2:][::-1]
    decoded_bits: list[str] = []
    for index in range(max(len(encoded_bits), len(mask_bits))):
        encoded_bit = int(encoded_bits[index]) if index < len(encoded_bits) else 0
        mask_bit = int(mask_bits[index]) if index < len(mask_bits) else 0
        decoded_bits.append(str(encoded_bit ^ mask_bit))
    tvid = int("".join(decoded_bits[::-1]), 2)
    if tvid < 900000:
        tvid = 100 * (tvid + 900000)
    return tvid


def decode_iqiyi_page_url_tvid(value: str) -> str | None:
    parsed = urlparse(normalize_input_url(value))
    positive_ids = parse_qs(parsed.query).get("positiveId")
    if positive_ids:
        try:
            raw_positive_id = positive_ids[0].encode("utf-8")
            return str(int(base64.b64decode(raw_positive_id).decode("utf-8")))
        except Exception:
            pass
    match = re.search(r"/[vwp]_([^/?#]+)\.html$", parsed.path)
    if not match:
        return None
    tvid = decode_iqiyi_path_token(match.group(1))
    return str(tvid) if tvid else None


def read_string_headers(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    headers: dict[str, str] = {}
    for name, header_value in value.items():
        if isinstance(name, str) and isinstance(header_value, str):
            headers[name] = header_value
    return headers


def infer_source_type(format_info: JsonObject) -> str | None:
    protocol = str(format_info.get("protocol") or "").lower()
    ext = str(format_info.get("ext") or "").lower()
    url = str(format_info.get("url") or "").lower()
    if "m3u8" in protocol or ext == "m3u8" or ".m3u8" in url:
        return "m3u8"
    if "dash" in protocol or ext == "mpd" or ".mpd" in url:
        return "mpd"
    if ext == "mp4" or ".mp4" in url:
        return "mp4"
    if ext == "flv" or ".flv" in url:
        return "flv"
    if ext in ("ts", "m2ts") or re.search(r"\.(?:ts|m2ts)(?:$|[?#])", url):
        return "ts"
    return None


def read_optional_number(value: Any) -> int | float | None:
    if isinstance(value, (int, float)) and value >= 0:
        return value
    return None


def build_quality_label(format_info: JsonObject) -> str | None:
    format_note = format_info.get("format_note")
    if isinstance(format_note, str) and format_note.strip():
        return format_note.strip()
    height = read_optional_number(format_info.get("height"))
    if height:
        return f"{int(height)}P"
    return None


def normalize_headers(value: Any) -> dict[str, str] | None:
    headers = read_string_headers(value)
    return headers or None


def get_static_media_source_type(value: str) -> str | None:
    parsed = urlparse(value)
    path = parsed.path.lower()
    if path.endswith(".m3u8"):
        return "m3u8"
    if path.endswith(".mpd"):
        return "mpd"
    if path.endswith(".mp4"):
        return "mp4"
    if path.endswith(".flv"):
        return "flv"
    if path.endswith(".ts") or path.endswith(".m2ts"):
        return "ts"
    return None


def build_static_format(
    url: str,
    index: int,
    headers: dict[str, str] | None = None,
) -> JsonObject:
    source_type = get_static_media_source_type(url)
    format_info: JsonObject = {
        "format_id": f"static-{index + 1}",
        "url": url,
    }
    if source_type == "m3u8":
        format_info["protocol"] = "m3u8_native"
        format_info["ext"] = "m3u8"
    elif source_type == "mpd":
        format_info["protocol"] = "dash"
        format_info["ext"] = "mpd"
    elif source_type == "mp4":
        format_info["ext"] = "mp4"
    elif source_type == "flv":
        format_info["ext"] = "flv"
    elif source_type == "ts":
        format_info["ext"] = "ts"
    if headers:
        format_info["http_headers"] = headers
    return format_info


def build_direct_media_title(url: str) -> str:
    parsed = urlparse(url)
    name = parsed.path.rstrip("/").rsplit("/", 1)[-1]
    return html.unescape(name or "Direct media")


def build_static_upstream_headers(
    page_url: str,
    headers: dict[str, str],
) -> dict[str, str]:
    upstream_headers = {"Referer": page_url}
    upstream_headers.update(headers)
    return upstream_headers


def read_static_html_title(body: str) -> str:
    title_match = re.search(r"<title[^>]*>(.*?)</title>", body, re.I | re.S)
    if title_match:
        title = re.sub(r"\s+", " ", html.unescape(title_match.group(1))).strip()
        if title:
            return title[:128]
    return "Static video"


def collect_static_media_urls(page_url: str, body: str) -> list[str]:
    normalized_body = html.unescape(body).replace("\\/", "/")
    candidates: list[str] = []

    for match in re.finditer(
        r"""(?:src|content)\s*=\s*(['"])(.*?)\1""",
        normalized_body,
        re.I | re.S,
    ):
        raw_url = match.group(2).strip()
        absolute_url = urljoin(page_url, raw_url)
        if is_http_url(absolute_url) and get_static_media_source_type(absolute_url):
            candidates.append(absolute_url)

    for match in re.finditer(
        r"""(?P<url>(?:https?:)?//[^'"\\\s<>]+?\.(?:m3u8|mpd|mp4|flv|ts|m2ts)(?:\?[^'"\\\s<>]*)?)""",
        normalized_body,
        re.I,
    ):
        absolute_url = urljoin(page_url, match.group("url").strip())
        if is_http_url(absolute_url) and get_static_media_source_type(absolute_url):
            candidates.append(absolute_url)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate not in seen:
            deduped.append(candidate)
            seen.add(candidate)
    return deduped


def extract_static_generic(
    url: str,
    headers: dict[str, str],
    download_fn: Callable[[str, dict[str, str]], str] | None = None,
) -> JsonObject:
    if get_static_media_source_type(url):
        return {
            "title": build_direct_media_title(url),
            "webpage_url": url,
            "is_live": False,
            "formats": [build_static_format(url, 0, headers or None)],
        }

    body = (download_fn or download_text)(url, headers)
    media_urls = collect_static_media_urls(url, body)
    if not media_urls:
        raise ExtractorHttpError(
            422,
            "unsupported_url",
            "URL is not supported by the extractor.",
        )
    upstream_headers = build_static_upstream_headers(url, headers)
    return {
        "title": read_static_html_title(body),
        "webpage_url": url,
        "is_live": False,
        "formats": [
            build_static_format(media_url, index, upstream_headers)
            for index, media_url in enumerate(media_urls[:16])
        ],
    }


def merge_iqiyi_request_headers(
    url: str,
    headers: dict[str, str],
) -> dict[str, str]:
    merged = {
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
        "Referer": url,
    }
    merged.update(headers)
    return merged


def download_text(url: str, headers: dict[str, str]) -> str:
    request = Request(url, headers=headers)
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", "replace")


def read_iqiyi_json_text(text: str) -> JsonObject:
    payload = text.strip()
    if payload.startswith("var tvInfoJs="):
        payload = payload[len("var tvInfoJs=") :]
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ExtractorHttpError(
            502,
            "iqiyi_invalid_response",
            "Iqiyi response was invalid.",
        )
    return data


def read_iqiyi_baseinfo(
    tvid: str,
    headers: dict[str, str],
) -> JsonObject:
    url = f"https://pcw-api.iqiyi.com/video/video/baseinfo/{tvid}"
    return read_iqiyi_json_text(download_text(url, headers))


def read_iqiyi_tmts(
    tvid: str,
    vid: str,
    headers: dict[str, str],
) -> JsonObject:
    timestamp = int(time.time() * 1000)
    key = "d5fb4bd9d50c4be6948c97edd7254b0e"
    signature = hashlib.md5(f"{timestamp}{key}{tvid}".encode("utf-8")).hexdigest()
    query = urlencode(
        {
            "tvid": tvid,
            "vid": vid,
            "src": "76f90cbd92f94a2e925d83e8ccd22cb7",
            "sc": signature,
            "t": timestamp,
        }
    )
    url = f"http://cache.m.iqiyi.com/jp/tmts/{tvid}/{vid}/?{query}"
    return read_iqiyi_json_text(download_text(url, headers))


def parse_iqiyi_screen_size(value: Any) -> tuple[int | None, int | None]:
    if not isinstance(value, str):
        return None, None
    match = re.match(r"^\s*(\d+)x(\d+)\s*$", value)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def map_iqiyi_display_quality(width: int | None, height: int | None) -> int | None:
    if width is not None:
        if width >= 3840:
            return 2160
        if width >= 2560:
            return 1440
        if width >= 1920:
            return 1080
        if width >= 1280:
            return 720
        if width >= 854:
            return 480
        if width >= 640:
            return 360
        if width >= 426:
            return 240
    if height is None:
        return None
    if height >= 800:
        return 1080
    if height >= 536:
        return 720
    if height >= 376:
        return 480
    if height >= 264:
        return 360
    if height >= 160:
        return 240
    return height


def normalize_iqiyi_tmts_stream(
    stream: JsonObject,
    index: int,
    headers: dict[str, str],
) -> JsonObject | None:
    stream_url = stream.get("m3utx") or stream.get("m3u")
    if not is_http_url(stream_url):
        return None
    width, height = parse_iqiyi_screen_size(stream.get("screenSize"))
    format_id = stream.get("vd") or stream.get("vid") or f"iqiyi-{index + 1}"
    format_info: JsonObject = {
        "format_id": str(format_id),
        "url": str(stream_url),
        "protocol": "m3u8_native",
        "ext": "m3u8",
        "http_headers": headers,
    }
    display_quality = map_iqiyi_display_quality(width, height)
    quality_prefix = f"{display_quality}P" if display_quality else None
    file_format = stream.get("fileFormat")
    if isinstance(file_format, str) and file_format.strip():
        format_info["format_note"] = (
            f"{quality_prefix} {file_format.strip()}"
            if quality_prefix
            else file_format.strip()
        )
    elif quality_prefix:
        format_info["format_note"] = quality_prefix
    if width is not None:
        format_info["width"] = width
    if height is not None:
        format_info["height"] = height
    return format_info


def extract_iqiyi_compat(url: str, headers: dict[str, str]) -> JsonObject:
    tvid = decode_iqiyi_page_url_tvid(url)
    if not tvid:
        raise ExtractorHttpError(
            422,
            "unsupported_url",
            "URL is not supported by the extractor.",
        )
    request_headers = merge_iqiyi_request_headers(url, headers)
    baseinfo = read_iqiyi_baseinfo(tvid, request_headers)
    baseinfo_data = baseinfo.get("data")
    if not isinstance(baseinfo_data, dict):
        raise ExtractorHttpError(
            502,
            "iqiyi_invalid_response",
            "Iqiyi metadata response was invalid.",
        )
    vid = baseinfo_data.get("vid")
    if not isinstance(vid, str) or not vid:
        raise ExtractorHttpError(
            422,
            "no_playable_candidates",
            "No supported playable candidates were found.",
        )
    tmts = read_iqiyi_tmts(tvid, vid, request_headers)
    if tmts.get("code") != "A00000":
        raise ExtractorHttpError(
            502,
            "iqiyi_invalid_response",
            "Iqiyi playback response was invalid.",
        )
    tmts_data = tmts.get("data")
    streams = tmts_data.get("vidl") if isinstance(tmts_data, dict) else None
    if not isinstance(streams, list):
        streams = []
    formats = [
        format_info
        for index, stream in enumerate(streams)
        if isinstance(stream, dict)
        for format_info in [
            normalize_iqiyi_tmts_stream(stream, index, request_headers)
        ]
        if format_info is not None
    ]
    return {
        "title": str(
            baseinfo_data.get("name")
            or baseinfo_data.get("title")
            or baseinfo_data.get("shortTitle")
            or "Iqiyi Video"
        ),
        "webpage_url": url,
        "is_live": False,
        "formats": formats,
    }


def normalize_candidate(format_info: JsonObject, index: int) -> JsonObject | None:
    url = format_info.get("url")
    if not is_http_url(url):
        return None
    source_type = infer_source_type(format_info)
    if source_type is None:
        return None
    if format_info.get("vcodec") == "none" and source_type != "m3u8":
        return None

    candidate: JsonObject = {
        "id": str(format_info.get("format_id") or f"format-{index + 1}"),
        "sourceType": source_type,
        "url": str(url),
    }
    quality_label = build_quality_label(format_info)
    if quality_label:
        candidate["qualityLabel"] = quality_label
    mime_type = format_info.get("mime_type")
    if isinstance(mime_type, str):
        candidate["mimeType"] = mime_type
    codecs = ",".join(
        value
        for value in (
            str(format_info.get("vcodec") or ""),
            str(format_info.get("acodec") or ""),
        )
        if value and value != "none"
    )
    if codecs:
        candidate["codecs"] = codecs
    width = read_optional_number(format_info.get("width"))
    height = read_optional_number(format_info.get("height"))
    bandwidth = read_optional_number(format_info.get("tbr"))
    if width is not None:
        candidate["width"] = width
    if height is not None:
        candidate["height"] = height
    if bandwidth is not None:
        candidate["bandwidth"] = bandwidth
    upstream_headers = normalize_headers(format_info.get("http_headers"))
    if upstream_headers:
        candidate["upstreamHeaders"] = upstream_headers
    return candidate


def normalize_extraction(source_url: str, info: JsonObject) -> JsonObject:
    formats = info.get("formats")
    if not isinstance(formats, list):
        formats = [info]
    candidates = [
        candidate
        for index, format_info in enumerate(formats)
        if isinstance(format_info, dict)
        for candidate in [normalize_candidate(format_info, index)]
        if candidate is not None
    ]
    if not candidates:
        raise ExtractorHttpError(
            422,
            "no_playable_candidates",
            "No supported playable candidates were found.",
        )

    return {
        "title": str(info.get("title") or "Untitled video")[:128],
        "sourceUrl": str(info.get("webpage_url") or source_url),
        "isLive": bool(info.get("is_live") or info.get("live_status") == "is_live"),
        "candidates": candidates[:16],
    }


def extract_with_ytdlp(url: str, headers: dict[str, str]) -> JsonObject:
    if yt_dlp is None:
        raise ExtractorHttpError(
            503,
            "engine_unavailable",
            "yt-dlp is not installed in this environment.",
        )
    options: JsonObject = {
        "skip_download": True,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "cachedir": False,
        "http_headers": headers,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)
        return ydl.sanitize_info(info)


def handle_extract_payload(
    payload: JsonObject,
    extract_fn: ExtractFn | None = None,
    iqiyi_extract_fn: IqiyiExtractFn | None = None,
    static_extract_fn: StaticExtractFn | None = None,
) -> JsonObject:
    raw_url = payload.get("url")
    url = normalize_input_url(raw_url) if isinstance(raw_url, str) else raw_url
    if not is_http_url(url):
        raise ExtractorHttpError(
            400,
            "invalid_request",
            "A valid http(s) url is required.",
        )
    headers = read_string_headers(payload.get("headers"))
    if get_static_media_source_type(str(url).strip()):
        info = (static_extract_fn or extract_static_generic)(str(url).strip(), headers)
        return normalize_extraction(str(url).strip(), info)
    try:
        info = (extract_fn or extract_with_ytdlp)(str(url).strip(), headers)
    except ExtractorHttpError:
        raise
    except Exception as error:
        error_message = str(error)
        lower_error_message = error_message.lower()
        if (
            is_iqiyi_page_url(str(url))
            and "iqiyi" in lower_error_message
            and "can't find any video" in lower_error_message
        ):
            info = (iqiyi_extract_fn or extract_iqiyi_compat)(str(url), headers)
            return normalize_extraction(str(url).strip(), info)
        if (
            "sign in" in lower_error_message
            or "cookies" in lower_error_message
            or "authentication" in lower_error_message
            or "not a bot" in lower_error_message
        ):
            raise ExtractorHttpError(
                401,
                "auth_required",
                "Extractor requires cookies or authentication.",
            ) from error
        if "Unsupported URL" in error_message:
            info = (static_extract_fn or extract_static_generic)(str(url).strip(), headers)
            return normalize_extraction(str(url).strip(), info)
        raise
    return normalize_extraction(str(url).strip(), info)


class ExtractorHandler(BaseHTTPRequestHandler):
    server_version = "SyncRoomMediaExtractor/0.1"

    def send_json(self, status: int, body: JsonObject) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path == "/health":
            self.send_json(200, build_health())
            return
        self.send_json(404, {"error": "not_found", "message": "Not found."})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path != "/extract":
            self.send_json(404, {"error": "not_found", "message": "Not found."})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ExtractorHttpError(
                    400,
                    "invalid_request",
                    "JSON body must be an object.",
                )
            self.send_json(200, handle_extract_payload(payload))
        except ExtractorHttpError as error:
            self.send_json(error.status, json.loads(error.message))
        except json.JSONDecodeError:
            self.send_json(
                400,
                {"error": "invalid_json", "message": "Invalid JSON body."},
            )
        except Exception:
            self.send_json(
                500,
                {"error": "internal_error", "message": "Extraction failed."},
            )

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


def main() -> None:
    host = os.environ.get("MEDIA_EXTRACTOR_HOST", "127.0.0.1")
    port = int(os.environ.get("MEDIA_EXTRACTOR_PORT", "8790"))
    server = ThreadingHTTPServer((host, port), ExtractorHandler)
    print(f"media-extractor-service listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
