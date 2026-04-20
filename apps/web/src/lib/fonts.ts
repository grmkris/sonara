import { Shippori_Mincho, Zen_Kaku_Gothic_New, IBM_Plex_Mono } from "next/font/google";

export const mincho = Shippori_Mincho({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mincho",
  display: "swap",
});

export const kaku = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-kaku",
  display: "swap",
});

export const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-plex",
  display: "swap",
});
