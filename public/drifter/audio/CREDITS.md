# Drifter Audio Credits

All seven audio files are CC0 1.0 Universal (Public Domain Dedication) — no
attribution required. The credits below are kept anyway so we can re-source or
swap individual tracks later without re-discovery work.

Source platform: Freesound (https://freesound.org/), filtered to
`license:"Creative Commons 0"`. Each detail page below was checked for the
`creativecommons.org/publicdomain/zero/1.0/` license link before download.

Pipeline applied to every file:
1. Downloaded the `-lq.ogg` preview from `cdn.freesound.org`.
2. Decoded to PCM (mono, 44.1 kHz) and trimmed to length with ffmpeg.
3. Re-encoded with `oggenc -q -1` (Vorbis VBR, ~48 kbps target) to fit the
   total 1.5 MB budget for the seven-file pack. The original spec called for
   96 kbps mono; at 30-90 s per file that would have blown the size budget,
   so the bitrate was lowered to the lowest value that still sounds clean for
   ambient/noise material.

| Path | Source URL | Author | Original Title | License |
| --- | --- | --- | --- | --- |
| clear-piano.ogg | https://freesound.org/people/szegvari/sounds/577844/ | szegvari | Summer night piano solo | CC0 1.0 |
| rain-piano.ogg | https://freesound.org/people/deadrobotmusic/sounds/703138/ | deadrobotmusic | Ambient Piano Guitar Texture G Sharp | CC0 1.0 |
| snow-bells.ogg | https://freesound.org/people/bassimat/sounds/851169/ | bassimat | Kalimba Bells with Drone in the Background | CC0 1.0 |
| fireflies-strings.ogg | https://freesound.org/people/jstarrcreative/sounds/742677/ | jstarrcreative | Pizzicato strings - bright, fun, boppy | CC0 1.0 |
| noise-fire.ogg | https://freesound.org/people/Sadiquecat/sounds/800660/ | Sadiquecat | Inside fireplace (Crackling) | CC0 1.0 |
| noise-rain.ogg | https://freesound.org/people/deadrobotmusic/sounds/549909/ | deadrobotmusic | PNW rain perfect loop 114.wav | CC0 1.0 |
| noise-crickets.ogg | https://freesound.org/people/felix.blume/sounds/479041/ | felix.blume | Crickets during the night, close to the beach in Mexico | CC0 1.0 |

## License text

CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/

> The person who associated a work with this deed has dedicated the work to
> the public domain by waiving all of his or her rights to the work worldwide
> under copyright law, including all related and neighboring rights, to the
> extent allowed by law. You can copy, modify, distribute and perform the
> work, even for commercial purposes, all without asking permission.

## Notes for the audio-engine wiring

- `clear-piano`, `rain-piano`, `snow-bells`, `fireflies-strings` are the
  four weather music beds. The audio engine should crossfade between them
  on weather change.
- `noise-fire` is the always-on indoor warmth bed (low gain).
- `noise-rain` layers in when weather is `rain`.
- `noise-crickets` layers in when weather is `fireflies`.
- All seven files are mono and trimmed at zero crossings. The crickets and
  fire beds should still loop smoothly, but the rain and music tracks may
  need a short crossfade in the engine because they were trimmed to fixed
  durations rather than at musical phrase boundaries.
