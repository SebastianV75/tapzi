# Tapzi

A personal, mobile-first soundboard for YouTube audio imports, online clips, and local files. Built with strict TypeScript, Vite, native browser controls, and IndexedDB. A small local importer uses yt-dlp and FFmpeg; no account or hosted application backend is required.

## Run locally

Requires Node.js 22.18+ and npm. To download from YouTube, also install current **yt-dlp with EJS**, a supported JavaScript runtime, and **FFmpeg/ffprobe** on the machine running Tapzi. Your successful terminal download is the prerequisite check. See [local import setup and limits](docs/importing.md).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). Imports are loopback-only by default. For phone imports on a **trusted** LAN, explicitly opt in with `TAPZI_ALLOW_LAN_IMPORT=1 npm run dev -- --host 0.0.0.0`, then open your computer's LAN address. Keep that computer running while importing; playback of already-stored audio does not contact YouTube. Do not expose this development/download server to the internet.

## Add and play a sound

1. Choose **Add a sound** and enter a name.
2. Paste an HTTPS YouTube video link, or switch to **Audio file** and choose a file up to 25 MB.
3. For YouTube, open **Trim audio (optional)** to set the start and optional end in seconds or `m:ss`. URL timestamps are not imported automatically; use these explicit fields.
4. **Download audio to this device** is checked by default. Open **About downloads & online links** for playback requirements and restrictions. Saving downloads/converts the selected audio on your computer and stores the returned file in this browser. Wait for it to finish, then tap its pad.
5. To keep using the official visible YouTube player instead, uncheck the download option before saving. Existing saved links are unchanged. Tap a pad again or use **Stop all** to stop playback.

Downloads need permission to use the content and may fail because of YouTube restrictions. A failed import displays the reason and adds no sound; it does not silently save another online link.

Star sounds for the Favorites filter. Search ignores capitalization and accents. The board starts empty; there are no placeholder sounds.

## Storage and playback boundaries

| Topic | Behavior |
| --- | --- |
| YouTube downloads | Local yt-dlp + FFmpeg importer creates an MP3, returned to this browser's IndexedDB. Internet and working server-machine tools are required during import. Up to 600 seconds and 25 MiB; one import at a time. Temporary server files are removed before responding. |
| YouTube links | Optional official visible player, online only. Existing links are preserved; videos may have ads, embedding restrictions, or regional limits. |
| Mobile playback | Imported/uploaded audio uses the native audio element. Saved online links may require another tap on the official Play button and depend on the network. |
| Local files | Uploaded and imported audio Blobs are stored in IndexedDB and played from object URLs. Uploads never go to the server. Imported audio passes through the local importer only during download. Format support depends on the browser. |
| Persistence | Sounds and favorites survive a reload on the same browser and origin. Clearing site data, private browsing cleanup, or browser storage eviction can remove the collection. There is no backup or sync yet. |
| Privacy | No analytics or account. Importing contacts YouTube from the server machine. Selecting a saved online-link pad contacts YouTube from the browser. Merely saving a link with downloading unchecked does not load the external player. No account-cookie workflow is provided. |
| Offline | Local files need no network once the app is open. The application shell has no service worker or offline-reload guarantee. |
| Home screen | A web manifest provides standalone launch metadata. Installation behavior depends on the browser; this is not a native mobile package. |

## Check and build

```sh
npm test                 # validation, local HTTP importer, guards, and subprocess tests
npm run typecheck        # strict TypeScript, including browser test source
npm run test:browser     # isolated Chromium UI checks
npm run build            # typecheck + production bundle in dist/
npm run preview          # serve production bundle + local importer
```

Browser checks require an installed `chromium` executable, or `CHROMIUM=/path/to/chrome`. They create a fresh profile, exercise public UI controls, and remove the profile afterward. Reports and a mobile screenshot go into ignored `.cache/`. The online YouTube adapter and import response use deterministic test doubles; local and imported-Blob playback use the real browser audio element with synthetic WAV bytes. Backend tests use an isolated fake executable, never YouTube or your data. This does **not** prove new live downloads, audio output, Safari behavior, or interaction on physical mobile hardware. The user's supplied terminal evidence separately confirms successful local yt-dlp conversion for the reported clip.

Before relying on it on a phone: try an embeddable video, check the clip bounds, try the extra native Play tap, switch between YouTube and a local file, and stop playback. These are device acceptance checks, not claims established by desktop tests.

## Visual direction

Pond-inspired pale blue surfaces, serif headings, technical outlines, mono numbering, and restrained lavender accents. A pocket sampler rather than an admin dashboard: the pads are the primary interaction. Touch targets, visible keyboard focus, native dialog behavior, and immediate press feedback take precedence over animation.

References requested by the user:

- [Pond Linux by Butterfly](https://www.butterfly.so/pond): aesthetic reference only; no proprietary fonts, illustrations, or branding copied.
- [Unslop by Damir Sokolovsky / @heydamir](https://github.com/heydamir/unslop), CC BY 4.0: visual design guidance.
- UI Skills and Emil Kowalski design-engineering guidance: interaction, accessibility, mobile behavior, and restraint.
- [Lucide](https://lucide.dev), ISC license: inline line-icon paths. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
