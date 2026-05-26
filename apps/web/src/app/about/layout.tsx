import type { Metadata } from "next";
import type { ReactNode } from "react";

// Server component so we can set per-page metadata; the page itself is a
// client component (it mounts the canvas backplate + WS hooks). With the root
// template "%s · sonara", this renders <title>About · sonara</title>.
export const metadata: Metadata = {
  title: "About",
  description: "What Sonara is, how it works, and who makes it.",
};

export default function AboutLayout({ children }: { children: ReactNode }) {
  return children;
}
