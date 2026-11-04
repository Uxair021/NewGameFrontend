import { useState } from "react";
import { Header } from "./Header";
import { Body } from "./Body";
import { SplashScreen } from "./SplashScreen";
import { ClickGlow } from "../shared/ClickGlow";

/** Ported from GameFun's "/" homepage — a casino-panel layout with a splash screen, a top
 * stats/action header, and a horizontally-scrolling game carousel. Wired to this app's own
 * auth (see useHomeAuthActions) instead of the source project's login modal. */
export function Home1Page() {
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  return (
    <div className="flex min-h-screen flex-col font-ui">
      <Header />
      <Body />
      <ClickGlow />
    </div>
  );
}
