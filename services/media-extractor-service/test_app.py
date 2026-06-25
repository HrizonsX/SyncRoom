import importlib.util
import json
import pathlib
import unittest


APP_PATH = pathlib.Path(__file__).with_name("app.py")
SPEC = importlib.util.spec_from_file_location("media_extractor_app", APP_PATH)
app = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(app)


class MediaExtractorServiceTests(unittest.TestCase):
    def test_build_health_reports_engine_version(self):
        self.assertEqual(
            app.build_health("2026.06.23"),
            {"ok": True, "engine": "yt-dlp", "version": "2026.06.23"},
        )

    def test_normalize_info_prefers_streamable_formats(self):
        info = {
            "webpage_url": "https://example.com/watch/123",
            "title": "Example Video",
            "is_live": False,
            "formats": [
                {
                    "format_id": "dash-audio",
                    "url": "https://cdn.example.com/audio.m4a",
                    "ext": "m4a",
                    "acodec": "mp4a.40.2",
                    "vcodec": "none",
                },
                {
                    "format_id": "hls-720",
                    "url": "https://cdn.example.com/index.m3u8",
                    "protocol": "m3u8_native",
                    "height": 720,
                    "width": 1280,
                    "http_headers": {
                        "Referer": "https://example.com/",
                        "User-Agent": "SyncRoomTest/1.0",
                    },
                },
                {
                    "format_id": "mp4-360",
                    "url": "https://cdn.example.com/video.mp4",
                    "ext": "mp4",
                    "height": 360,
                    "width": 640,
                },
            ],
        }

        self.assertEqual(
            app.normalize_extraction("https://example.com/watch/123", info),
            {
                "title": "Example Video",
                "sourceUrl": "https://example.com/watch/123",
                "isLive": False,
                "candidates": [
                    {
                        "id": "hls-720",
                        "sourceType": "m3u8",
                        "url": "https://cdn.example.com/index.m3u8",
                        "qualityLabel": "720P",
                        "width": 1280,
                        "height": 720,
                        "upstreamHeaders": {
                            "Referer": "https://example.com/",
                            "User-Agent": "SyncRoomTest/1.0",
                        },
                    },
                    {
                        "id": "mp4-360",
                        "sourceType": "mp4",
                        "url": "https://cdn.example.com/video.mp4",
                        "qualityLabel": "360P",
                        "width": 640,
                        "height": 360,
                    },
                ],
            },
        )

    def test_extract_request_uses_request_scoped_headers(self):
        calls = []

        def fake_extract(url, headers):
            calls.append({"url": url, "headers": headers})
            return {
                "title": "Header Video",
                "webpage_url": url,
                "formats": [
                    {
                        "format_id": "http-mp4",
                        "url": "https://cdn.example.com/video.mp4",
                        "ext": "mp4",
                    }
                ],
            }

        response = app.handle_extract_payload(
            {
                "url": "https://example.com/watch/headers",
                "platform": "generic",
                "headers": {"Referer": "https://example.com/"},
            },
            fake_extract,
        )

        self.assertEqual(
            calls,
            [
                {
                    "url": "https://example.com/watch/headers",
                    "headers": {"Referer": "https://example.com/"},
                }
            ],
        )
        self.assertEqual(response["title"], "Header Video")
        self.assertEqual(response["candidates"][0]["sourceType"], "mp4")

    def test_handle_extract_payload_rejects_invalid_payload(self):
        with self.assertRaises(app.ExtractorHttpError) as context:
            app.handle_extract_payload({"url": "file:///tmp/video.mp4"}, None)

        self.assertEqual(context.exception.status, 400)
        self.assertEqual(
            json.loads(context.exception.message),
            {"error": "invalid_request", "message": "A valid http(s) url is required."},
        )

    def test_handle_extract_payload_maps_unsupported_urls(self):
        def fake_extract(url, headers):
            raise Exception(f"Unsupported URL: {url}")

        def fake_static_extract(url, headers):
            raise app.ExtractorHttpError(
                422,
                "unsupported_url",
                "URL is not supported by the extractor.",
            )

        with self.assertRaises(app.ExtractorHttpError) as context:
            app.handle_extract_payload(
                {"url": "https://haokan.baidu.com/v?vid=1"},
                fake_extract,
                static_extract_fn=fake_static_extract,
            )

        self.assertEqual(context.exception.status, 422)
        self.assertEqual(
            json.loads(context.exception.message),
            {
                "error": "unsupported_url",
                "message": "URL is not supported by the extractor.",
            },
        )

    def test_static_extract_accepts_direct_media_urls(self):
        def fail_download(url, headers):
            raise AssertionError("direct media URLs should not download HTML")

        info = app.extract_static_generic(
            "https://cdn.example.com/live/index.m3u8?token=abc",
            {"User-Agent": "SyncRoomTest/1.0"},
            fail_download,
        )

        self.assertEqual(
            app.normalize_extraction(
                "https://cdn.example.com/live/index.m3u8?token=abc",
                info,
            ),
            {
                "title": "index.m3u8",
                "sourceUrl": "https://cdn.example.com/live/index.m3u8?token=abc",
                "isLive": False,
                "candidates": [
                    {
                        "id": "static-1",
                        "sourceType": "m3u8",
                        "url": "https://cdn.example.com/live/index.m3u8?token=abc",
                        "upstreamHeaders": {
                            "User-Agent": "SyncRoomTest/1.0",
                        },
                    }
                ],
            },
        )

    def test_handle_extract_payload_accepts_direct_media_without_ytdlp(self):
        def fail_extract(url, headers):
            raise AssertionError("direct media URLs should not call yt-dlp")

        response = app.handle_extract_payload(
            {"url": "https://cdn.example.com/video.mp4"},
            fail_extract,
        )

        self.assertEqual(response["title"], "video.mp4")
        self.assertEqual(response["candidates"][0]["sourceType"], "mp4")

    def test_static_extract_accepts_direct_flv_and_ts_urls(self):
        def fail_extract(url, headers):
            raise AssertionError("direct media URLs should not call yt-dlp")

        flv_response = app.handle_extract_payload(
            {"url": "https://cdn.example.com/live.flv"},
            fail_extract,
        )
        ts_response = app.handle_extract_payload(
            {"url": "https://cdn.example.com/live.ts"},
            fail_extract,
        )

        self.assertEqual(flv_response["title"], "live.flv")
        self.assertEqual(flv_response["candidates"][0]["sourceType"], "flv")
        self.assertEqual(ts_response["title"], "live.ts")
        self.assertEqual(ts_response["candidates"][0]["sourceType"], "ts")

    def test_static_extract_discovers_media_urls_from_html(self):
        html_body = """
            <html>
              <head>
                <title>Static Clip</title>
                <meta property="og:video" content="//cdn.example.com/og.mp4">
              </head>
              <body>
                <video src="/media/local.mp4"></video>
                <source src="https://cdn.example.com/live/index.m3u8">
                <source src="https://cdn.example.com/live/stream.flv">
                <script>
                  window.dash = "https:\\/\\/cdn.example.com\\/dash\\/manifest.mpd";
                  window.ts = "https:\\/\\/cdn.example.com\\/live\\/segment.ts";
                </script>
              </body>
            </html>
        """
        calls = []

        def fake_download(url, headers):
            calls.append({"url": url, "headers": headers})
            return html_body

        info = app.extract_static_generic(
            "https://example.com/watch/123",
            {"User-Agent": "SyncRoomTest/1.0"},
            fake_download,
        )
        normalized = app.normalize_extraction("https://example.com/watch/123", info)

        self.assertEqual(
            calls,
            [
                {
                    "url": "https://example.com/watch/123",
                    "headers": {"User-Agent": "SyncRoomTest/1.0"},
                }
            ],
        )
        self.assertEqual(normalized["title"], "Static Clip")
        self.assertEqual(
            normalized["candidates"],
            [
                {
                    "id": "static-1",
                    "sourceType": "mp4",
                    "url": "https://cdn.example.com/og.mp4",
                    "upstreamHeaders": {
                        "Referer": "https://example.com/watch/123",
                        "User-Agent": "SyncRoomTest/1.0",
                    },
                },
                {
                    "id": "static-2",
                    "sourceType": "mp4",
                    "url": "https://example.com/media/local.mp4",
                    "upstreamHeaders": {
                        "Referer": "https://example.com/watch/123",
                        "User-Agent": "SyncRoomTest/1.0",
                    },
                },
                {
                    "id": "static-3",
                    "sourceType": "m3u8",
                    "url": "https://cdn.example.com/live/index.m3u8",
                    "upstreamHeaders": {
                        "Referer": "https://example.com/watch/123",
                        "User-Agent": "SyncRoomTest/1.0",
                    },
                },
                {
                    "id": "static-4",
                    "sourceType": "flv",
                    "url": "https://cdn.example.com/live/stream.flv",
                    "upstreamHeaders": {
                        "Referer": "https://example.com/watch/123",
                        "User-Agent": "SyncRoomTest/1.0",
                    },
                },
                {
                    "id": "static-5",
                    "sourceType": "mpd",
                    "url": "https://cdn.example.com/dash/manifest.mpd",
                    "upstreamHeaders": {
                        "Referer": "https://example.com/watch/123",
                        "User-Agent": "SyncRoomTest/1.0",
                    },
                },
                {
                    "id": "static-6",
                    "sourceType": "ts",
                    "url": "https://cdn.example.com/live/segment.ts",
                    "upstreamHeaders": {
                        "Referer": "https://example.com/watch/123",
                        "User-Agent": "SyncRoomTest/1.0",
                    },
                },
            ],
        )

    def test_handle_extract_payload_falls_back_to_static_discovery(self):
        def fake_extract(url, headers):
            raise Exception(f"Unsupported URL: {url}")

        def fake_static_extract(url, headers):
            return {
                "title": "Static Fallback",
                "webpage_url": url,
                "formats": [
                    {
                        "format_id": "static-1",
                        "url": "https://cdn.example.com/video.mp4",
                        "ext": "mp4",
                    }
                ],
            }

        response = app.handle_extract_payload(
            {"url": "https://example.com/watch/static"},
            fake_extract,
            static_extract_fn=fake_static_extract,
        )

        self.assertEqual(response["title"], "Static Fallback")
        self.assertEqual(response["candidates"][0]["sourceType"], "mp4")

    def test_handle_extract_payload_maps_auth_required_urls(self):
        def fake_extract(url, headers):
            raise Exception(
                "Sign in to confirm you’re not a bot. "
                "Use --cookies-from-browser or --cookies for the authentication."
            )

        with self.assertRaises(app.ExtractorHttpError) as context:
            app.handle_extract_payload(
                {"url": "https://www.youtube.com/watch?v=keOaQm6RpBg"},
                fake_extract,
            )

        self.assertEqual(context.exception.status, 401)
        self.assertEqual(
            json.loads(context.exception.message),
            {
                "error": "auth_required",
                "message": "Extractor requires cookies or authentication.",
            },
        )

    def test_decode_iqiyi_page_url_tvid(self):
        self.assertEqual(
            app.decode_iqiyi_page_url_tvid(
                "https://www.iqiyi.com/v_tenslt1rzg.html?foo=bar"
            ),
            "3071192221488000",
        )

    def test_normalize_iqiyi_tmts_stream_maps_cropped_heights_to_display_quality(self):
        candidate = app.normalize_candidate(
            app.normalize_iqiyi_tmts_stream(
                {
                    "vd": 17,
                    "m3utx": "https://meta.video.iqiyi.com/video.m3u8",
                    "screenSize": "1280x536",
                    "fileFormat": "H265",
                },
                0,
                {"User-Agent": "SyncRoomTest/1.0"},
            ),
            0,
        )

        self.assertEqual(candidate["qualityLabel"], "720P H265")

        candidate = app.normalize_candidate(
            app.normalize_iqiyi_tmts_stream(
                {
                    "vd": 18,
                    "m3utx": "https://meta.video.iqiyi.com/video-1080.m3u8",
                    "screenSize": "1920x800",
                },
                0,
                {"User-Agent": "SyncRoomTest/1.0"},
            ),
            0,
        )

        self.assertEqual(candidate["qualityLabel"], "1080P")

    def test_handle_extract_payload_falls_back_for_iqiyi_new_player_page(self):
        calls = []

        def fake_extract(url, headers):
            raise Exception("ERROR: [iqiyi] Can't find any video")

        def fake_iqiyi_extract(url, headers):
            calls.append({"url": url, "headers": headers})
            return {
                "title": "Iqiyi Movie",
                "webpage_url": "https://www.iqiyi.com/v_tenslt1rzg.html",
                "formats": [
                    {
                        "format_id": "1",
                        "url": "https://meta.video.iqiyi.com/video.m3u8",
                        "protocol": "m3u8_native",
                        "height": 360,
                        "width": 640,
                        "http_headers": {
                            "Referer": "https://www.iqiyi.com/v_tenslt1rzg.html",
                            "User-Agent": "SyncRoomTest/1.0",
                        },
                    }
                ],
            }

        response = app.handle_extract_payload(
            {
                "url": "https://www.iqiyi.com/v_tenslt1rzg.html?x=1&amp;y=2",
                "platform": "generic",
                "headers": {"User-Agent": "SyncRoomTest/1.0"},
            },
            fake_extract,
            fake_iqiyi_extract,
        )

        self.assertEqual(
            calls,
            [
                {
                    "url": "https://www.iqiyi.com/v_tenslt1rzg.html?x=1&y=2",
                    "headers": {"User-Agent": "SyncRoomTest/1.0"},
                }
            ],
        )
        self.assertEqual(response["title"], "Iqiyi Movie")
        self.assertEqual(response["candidates"][0]["sourceType"], "m3u8")
        self.assertEqual(response["candidates"][0]["qualityLabel"], "360P")


if __name__ == "__main__":
    unittest.main()
