import type { Metadata } from "next";
import type { ReactNode } from "react";

// Server component so we can set per-page metadata; the page itself is a
// client component (auth gate + polled stage list). With the root template
// "%s · sonara", this renders <title>Stages · sonara</title>.
export const metadata: Metadata = {
  description:
    "Your stages — permanent rooms with a code, a crowd QR, a screen, and a console.",
  title: "Stages",
};

export default function StagesLayout({ children }: { children: ReactNode }) {
  return children;
}
