# ALTNEXT 2026 — Sonara operator runbook

**Show:** Sonicite A/V set · AltNext Season 2, Shanghai · **Sat June 13, 17:00–17:20 CST** ·
main closing stage (center vertical panel + two side panels) · PatchXR follows at 17:25.

The whole set runs on **8 pre-generated decks — one per phase**. Picking a deck applies
its full look in one move: the frames, the render preset, the audio-reactivity intensity,
and the frame cadence all switch together. There is nothing else to adjust mid-show.

## The 8 phases

| Time | Deck (in the picker) | Music phase | Feel |
|---|---|---|---|
| 0:00 | **Altnext 01 · Emergence** | Boot — no beat, pure texture | near-still violet particles |
| 2:30 | **Altnext 02 · Signal** | First groove (Hosono) | city-as-data, teal accents |
| 5:30 | **Altnext 03 · Lattice** | Broken beat building | geometry + light trails |
| 8:30 | **Altnext 04 · Rose** | Synthpop melody — the emotional peak | rose gold enters |
| 11:00 | **Altnext 05 · Surge** | UKG — energy jumps | liquid metal, motion |
| 13:30 | **Altnext 06 · Pressure** | Experimental techno — peak | maximum density + reactivity |
| 16:30 | **Altnext 07 · Resolve** | Layers fall away | drifting fragments, slow |
| 18:30 | **Altnext 08 · Open End** | Unresolved pad | one thread of light — **hold for PatchXR** |

Reactivity ramps automatically with each deck (0.15 → 0.85 → 0.2). Cadence ramps
12s-per-frame (calm) down to 2s (peak) and back.

## Setup (at soundcheck)

1. **Sign in** on the show laptop at the site with an allowlisted account
   (brenda@sonicite.ai or kristjan.grm1@gmail.com) — the Altnext decks are unlisted
   and only appear for these accounts.
2. Open **/play**, fullscreen it on the LED feed (browser fullscreen, hide cursor).
3. **Audio in:** enable the mic/audio input in the controls and confirm the visuals
   react to the house PA during soundcheck. The reactivity is what sells phases 5–6.
4. **Warm the cache:** open the source switcher ("now showing") and cycle through all
   8 Altnext decks once, letting each show a few frames. This pulls every image into
   the browser/service-worker cache so mid-show playback doesn't depend on venue
   internet. **Keep this tab open from soundcheck to showtime.**
5. Dry-run two or three phase switches against the timestamp list.

## During the show

- At each timestamp: open the source switcher → tap the next Altnext deck. That's the
  whole job. Switches are instant; frames crossfade.
- **Crowd moment (~10–12 min, during Surge):** in the stage console, toggle
  **"join qr on display"** — the projector shows a QR that puts the crowd's phones on
  a remote where taps nudge the visuals (free) and prompts go through the on-chain
  flow. Toggle it off after a couple of minutes.
- Phase switches can also be done from a **second device** (phone) via the stage
  console — deck picks sync to the screen. The laptop is still the safest place.
- Don't touch stop. To end: leave **Altnext 08** holding its last frames until
  PatchXR's visuals take the feed.

## Network notes (Shanghai)

- All show content is pre-generated and cached after the warm-up — no AI calls, no
  credits, no payments needed during the set.
- Google services (Meet, etc.) are blocked on mainland networks; the site itself rides
  Cloudflare and should resolve, but **test on the actual venue network at soundcheck**
  and have a phone-hotspot + VPN fallback ready.
- Worst case mid-show (connection drops after warm-up): the playing deck keeps looping
  from cache — finish the phase, switch when connectivity returns.

## If something looks wrong

- Visuals not reacting → audio input got revoked; re-enable mic permission.
- A deck chip missing → you're signed out or on a non-allowlisted account.
- Screen kicked to "taken over" → another device claimed the screen; reclaim on the laptop.
