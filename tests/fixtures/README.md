`tone.mp4` is an original synthetic test fixture: 2 seconds of solid pale blue video
(H.264, 64×64) and a 440 Hz tone (AAC). No third-party content. Generated with FFmpeg:

```sh
ffmpeg -f lavfi -i 'color=c=0xe1ebf7:s=64x64:d=2' \
  -f lavfi -i 'sine=frequency=440:duration=2' \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart tone.mp4
```

FFmpeg is **not** an application or test-runner dependency; the fixture is committed.
