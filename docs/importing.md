# Import YouTube audio locally

Use only public audio you have permission to download. Imports run on the machine
running Tapzi's Vite server, not on a static hosting site or in the browser alone.

## Setup

Use Node 22.18+ and install current **yt-dlp with EJS support**, a supported
JavaScript runtime (Deno or Node), and **FFmpeg including ffprobe** using your
preferred package manager. Check yt-dlp's current installation instructions for
EJS/runtime requirements. No project-local `.tools` installation is assumed.
The importer enables Node as well as yt-dlp's default Deno runtime.

Run `npm run dev`, or build normally then use `npm run preview`. Both servers
provide the endpoint; serving `dist` alone does not. No cookies, sign-in, or
account/restriction bypass is supported. This is not an offline downloader:
YouTube and installed tools must work from the server machine.

Optional trusted **server environment** settings:

- `TAPZI_YTDLP_PATH`: yt-dlp executable; defaults to `yt-dlp` on PATH.
- `TAPZI_FFMPEG_PATH`: FFmpeg executable or containing directory understood by
  yt-dlp's `--ffmpeg-location`; otherwise FFmpeg/ffprobe use PATH.
- `TAPZI_ALLOW_LAN_IMPORT=1`: allow imports from a trusted LAN, retaining
  same-origin checks. Default: loopback clients and loopback/localhost Host only.
  LAN use also requires binding Vite to a LAN interface. **Trusted networks only;
  this is not a public service.** Forwarded headers do not override the checks.

POSIX hosts (Linux, macOS, WSL) are required so cancellation can terminate the
whole subprocess group. Native Windows imports return setup guidance rather than
risk leaving FFmpeg descendants running.

## Endpoint

`POST /api/import-audio` with `Content-Type: application/json`, same-origin
`Origin`, and a body such as:

```json
{"url":"https://www.youtube.com/watch?v=fTCbikSOYBg","start":"0:02","end":"0:05"}
```

Only `url` and optional string `start`/`end` fields are accepted. Times use the
existing sound validator (seconds or colon-separated time); defaults are 0 and
the video's end. End must follow start and clip bounds must fit the video.
Only validated YouTube IDs are passed as canonical HTTPS watch URLs. Executable
paths, output paths, and shell expressions cannot be supplied by a request.

Success: `200 audio/mpeg`, binary MP3, attachment filename
`tapzi-<videoid>.mp3`. Errors: JSON `{"error":"safe actionable message"}`.
Audio and errors use `Cache-Control: no-store`.

- 400 invalid JSON, link, fields, or time; 413 JSON exceeds 4 KB; 415 not JSON.
- 403 nonlocal or cross-origin request; 405 wrong method (`Allow: POST`).
- 429 another import is running; retry after it finishes.
- 422 live/unknown/over-600-second duration, oversized media, or out-of-range clip.
- 503 missing tools or unsupported platform; 504 120-second deadline; 502 failed
  extraction, including YouTube bot/sign-in challenges. Failed imports save nothing.

One import runs at a time. Source/download/output limit: 25 MiB. yt-dlp's source
size check and a temporary-directory size watchdog bound downloads; the watchdog
is sampled, not an OS disk quota, so a burst may briefly exceed the limit before
termination. Output size is checked before reading or returning it. Subprocess
output is capped at 1 MiB and retries are disabled. Each request uses isolated
system-temp files, removed before the response, including failure/cancellation.
Nothing is persisted in server application storage. The browser integration owns
saving returned audio to its existing local storage flow.

## What has actually worked

The user's local PC successfully downloaded the exact `fTCbikSOYBg` example using
yt-dlp + Deno + FFmpeg (39.23 KiB, converted to MP3). The remote development
machine instead received YouTube's “Sign in to confirm you're not a bot” challenge.
That is a downloader restriction, distinct from the earlier iframe error 150.
It does not negate the user's local success or guarantee other links/networks.
No further live probe or listening/mobile validation is implied by endpoint tests.
