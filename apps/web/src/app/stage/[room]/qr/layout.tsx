import type { Metadata } from "next";
import type { ReactNode } from "react";

// Server component so the printed page header carries a sane title. With the
// root template "%s · sonara", this renders <title>Stage QR · sonara</title>.
export const metadata: Metadata = {
  description: "Printable crowd-join QR for a stage.",
  title: "Stage QR",
};

export default function StageQrLayout({ children }: { children: ReactNode }) {
  return children;
}
