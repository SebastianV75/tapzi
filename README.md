# Tapzi

A personal, mobile-first soundboard for YouTube clips and local audio. Built with strict TypeScript, Vite, native browser controls, and IndexedDB. No account or application backend.

## Run locally

Requires Node.js 22.18+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). To test from a phone on your trusted local network, run `npm run dev -- --host 0.0.0.0` and open your computer's LAN address. Do not expose the development server to the internet.

## Add and play a sound

1. Choose **Add a sound** and enter a name.
2. Paste an HTTPS YouTube video link, or switch to **Audio file** and choose a file up to 25 MB.
3. For YouTube, set the start and optional end in seconds or `m:ss`. URL timestamps are not imported automatically; use these explicit fields.
4. Save, then tap the numbered pad. Tap it again or use **Stop all** to stop playback.

Star sounds for the Favorites filter. Search ignores capitalization and accents. The board starts empty; there are no placeholder sounds.

## Storage and playback boundaries

| Topic | Behavior |
| --- | --- |
| YouTube | Official visible player, online only. No extraction, MP3 conversion, or downloads. Videos may have ads, embedding restrictions, or regional limits. |
| Mobile playback | Browsers may require another tap on the official Play button. Tap-to-play latency depends on the network and YouTube. |
| Local files | Audio Blobs are stored in this browser's IndexedDB and played from object URLs. Files never go to an application server. Format support depends on the browser. |
| Persistence | Sounds and favorites survive a reload on the same browser and origin. Clearing site data, private browsing cleanup, or browser storage eviction can remove the collection. There is no backup or sync yet. |
| Privacy | No analytics or account. Selecting a YouTube pad contacts YouTube; adding a link alone does not load the external player. |
| Offline | Local files need no network once the app is open. The application shell has no service worker or offline-reload guarantee. |
| Home screen | A web manifest provides standalone launch metadata. Installation behavior depends on the browser; this is not a native mobile package. |

## Check and build

```sh
npm test                 # deterministic validation and search tests
npm run typecheck        # strict TypeScript, including browser test source
npm run test:browser     # isolated Chromium UI checks
npm run build            # typecheck + production bundle in dist/
npm run preview          # serve the production bundle locally
```

Browser checks require an installed `chromium` executable, or `CHROMIUM=/path/to/chrome`. They create a fresh profile, exercise public UI controls, and remove the profile afterward. Reports and a mobile screenshot go into ignored `.cache/`. The YouTube adapter uses a deterministic test double; local WAV playback uses the real browser audio element. This does **not** prove live YouTube playback, audio output, Safari behavior, or interaction on physical mobile hardware.

Before relying on it on a phone: try an embeddable video, check the clip bounds, try the extra native Play tap, switch between YouTube and a local file, and stop playback. These are device acceptance checks, not claims established by desktop tests.

## Visual direction

Pond-inspired pale blue surfaces, serif headings, technical outlines, mono numbering, and restrained lavender accents. A pocket sampler rather than an admin dashboard: the pads are the primary interaction. Touch targets, visible keyboard focus, native dialog behavior, and immediate press feedback take precedence over animation.

References requested by the user:

- [Pond Linux by Butterfly](https://www.butterfly.so/pond): aesthetic reference only; no proprietary fonts, illustrations, or branding copied.
- [Unslop by Damir Sokolovsky / @heydamir](https://github.com/heydamir/unslop), CC BY 4.0: visual design guidance.
- UI Skills and Emil Kowalski design-engineering guidance: interaction, accessibility, mobile behavior, and restraint.
- [Lucide](https://lucide.dev), ISC license: inline line-icon paths. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
