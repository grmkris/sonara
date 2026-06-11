"use client";

import { StageScreen } from "@/components/stage-screen/stage-screen";

// /play is an ALIAS: the screen face of your default stage (anon visitors get
// the demo instrument). A named stage's screen lives at /stage/<code>/screen.
export default function Page() {
  return <StageScreen code={null} />;
}
