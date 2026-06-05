import { Fraunces, Public_Sans, IBM_Plex_Mono } from "next/font/google";

// Editorial serif for display, wordmark, typed scene values. Variable axes
// (opsz, wght, soft) give us a single family that reads as magazine headline
// at 42 px and as caption at 14 px.
export const serif = Fraunces({
  display: "swap",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600", "700"],
});

// UI label sans — small-caps tracking for buttons, section labels, HUD
// readouts. Public Sans is USWDS-derived (free, proportional workhorse, not
// Inter / Space Grotesk / Geist).
export const sans = Public_Sans({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600"],
});

// Tabular telemetry — version counters, timecodes, slider readouts.
export const mono = IBM_Plex_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["300", "400", "500"],
});
