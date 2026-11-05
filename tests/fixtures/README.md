`tone.mp4` is an original synthetic test fixture: 2 seconds of solid pale blue video
(H.264, 64×64) and a 440 Hz tone (AAC). No third-party content. Generated with FFmpeg:

```sh
ffmpeg -f lavfi -i 'color=c=0xe1ebf7:s=64x64:d=2' \
  -f lavfi -i 'sine=frequency=440:duration=2' \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart tone.mp4
```

FFmpeg is **not** an application or test-runner dependency; the fixture is committed.

`tone.mp3` contains only the audio from the same original fixture, encoded as mono
MP3 at 22,050 Hz / 64 kbps for real browser import and trim tests:

```sh
ffmpeg -i tone.mp4 -vn -ac 1 -ar 22050 -codec:a libmp3lame -b:a 64k tone.mp3
```
