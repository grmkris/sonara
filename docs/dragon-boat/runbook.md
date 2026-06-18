# Dragon Boat Festival — Sonara operator runbook

**Show:** Sonicite A/V set · Dragon-Boat-Festival theme · **INS Land, Shanghai** ·
50-minute set · outdoor, **late afternoon** (bright — the set stays in jade/gold,
never goes dark).

The whole set runs on **5 pre-generated decks — one per visual world**. Picking a deck
applies its full look in one move: the frames, the render preset, the audio-reactivity
intensity, and the frame cadence all switch together. There is nothing else to adjust
mid-show.

**The only timing you need:** start a phone **stopwatch** the moment the music begins,
then tap the next deck at **12, 22, 35, and 43 minutes** in. The times below are
minutes-into-the-set, not clock times — nothing to pre-fill. That's 5 taps in 50 minutes.

## The 5 worlds

| Set time | Deck (in the picker) | World / mood | Feel |
|---|---|---|---|
| 0:00 | **Dragon 01 · River Awakening** | serene, mystical dawn | near-still jade water, mist, drifting bamboo & lotus |
| 12:00 | **Dragon 02 · Gathering** | joyful, communal | silk-ribbon & lantern light, dragonflies, warm dusk |
| 22:00 | **Dragon 03 · Dragon Spirit** | powerful, mythological | serpentine light, jade dragon scales, sacred geometry |
| 35:00 | **Dragon 04 · Race** | dynamic, rhythmic, **peak** | kinetic light trails, racing water, max reactivity |
| 43:00 | **Dragon 05 · Jade Future** | sacred, futuristic, transcendent | jade temples + neural lattice, golden sunrise — **hold to the end** |

Reactivity ramps automatically with each deck (0.2 → 0.9 → 0.4 across the arc).
Cadence ramps 12s-per-frame (calm) down to ~2s (peak race) and back up for the finale.

Palette across the whole set: **jade / emerald / moss green with gold & ivory highlights** —
benevolent blue-green dragons, water, bamboo, lotus. Deliberately bright; no dark or
"apocalyptic" tones (outdoor afternoon show).

## Setup (at soundcheck)

1. **Sign in** on the show laptop at the site with an allowlisted account
   (brenda@sonicite.ai or kristjan.grm1@gmail.com) — the Dragon decks are unlisted and
   only appear for these accounts.
2. Open **/play**, fullscreen it on the LED feed (browser fullscreen, hide cursor).
3. **Audio in:** enable the mic/audio input in the controls and confirm the visuals react
   to the house PA during soundcheck. The reactivity is what sells the Dragon Spirit and
   Race worlds.
4. **Warm the cache:** open the source switcher ("now showing") and cycle through all 5
   Dragon decks once, letting each show a few frames. This pulls every image into the
   browser/service-worker cache so mid-show playback doesn't depend on venue internet.
   **Keep this tab open from soundcheck to showtime.**
5. Dry-run two or three world switches against the timecodes above.

## During the show

- At each timecode: open the source switcher → tap the next Dragon deck. That's the whole
  job. Switches are instant; frames crossfade.
- **Crowd moment (optional, during Gathering ~12–22 min):** in the stage console, toggle
  **"join qr on display"** — the projector shows a QR that puts the crowd's phones on a
  remote where taps nudge the visuals. Toggle it off after a couple of minutes.
- World switches can also be done from a **second device** (phone) via the stage console —
  deck picks sync to the screen. The laptop is still the safest place.
- Don't touch stop. To end: leave **Dragon 05 · Jade Future** holding its last frames as
  the music resolves.

## Network notes (Shanghai)

- All show content is pre-generated and cached after the warm-up — no AI calls, no credits,
  no payments needed during the set.
- Google services are blocked on mainland networks; the site itself rides Cloudflare and
  should resolve, but **test on the actual venue network at soundcheck** and have a
  phone-hotspot + VPN fallback ready.
- Worst case mid-show (connection drops after warm-up): the playing deck keeps looping from
  cache — finish the world, switch when connectivity returns.

## If something looks wrong

- Visuals not reacting → audio input got revoked; re-enable mic permission.
- A deck chip missing → you're signed out or on a non-allowlisted account.
- Screen kicked to "taken over" → another device claimed the screen; reclaim on the laptop.
