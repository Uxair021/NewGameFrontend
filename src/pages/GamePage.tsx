import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { getGameBySlug } from "../games/registry";
import { resumeAudio } from "../games/shared/sound/soundEngine";

export function GamePage() {
  const { slug } = useParams();
  const game = slug ? getGameBySlug(slug) : undefined;
  const pageRef = useRef<HTMLDivElement>(null);
  const [contextLost, setContextLost] = useState(false);

  /**
   * Safety net for WebGL context loss — normally rare, but a real risk on mobile Safari
   * specifically, which has a low ceiling on concurrent WebGL contexts. Any cause of context
   * loss (backgrounding, OS memory pressure, a different mobile browser's own limits) would
   * otherwise be a silent, unrecoverable dead end — the game just sits on its loading screen
   * forever with nothing telling the player anything went wrong. `webglcontextlost` bubbles, so
   * one listener up here catches it regardless of which game/canvas underneath it fires it.
   */
  useEffect(() => {
    setContextLost(false);
    const node = pageRef.current;
    if (!node) return;
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    node.addEventListener("webglcontextlost", handleContextLost);
    return () => node.removeEventListener("webglcontextlost", handleContextLost);
  }, [slug]);

  /**
   * Try to unlock audio right away, on the same tick as mount — the tap/click that
   * navigated onto this page is still "sticky" user activation for this document (no full
   * page reload happened, just client-side routing), so this alone is often enough for the
   * background music to actually start playing the instant the loading screen finishes,
   * with no further tap needed. As a fallback for browsers that don't honor that, also
   * unlock on the very first interaction anywhere on the page (not tied to any specific
   * button) — no browser lets audio play with truly zero interaction ever, that's an
   * OS-level restriction no site can bypass, so this is the most permissive path there is.
   *
   * Wrapped in try/catch: resumeAudio() constructs a Web Audio AudioContext, and this call
   * happens at mount (an effect), not inside a click handler — an uncaught exception here is
   * a render-lifecycle error, which (with no error boundary anywhere in this app) would unmount
   * the whole page. Audio failing to unlock should never be able to take the rest of the game
   * down with it.
   */
  useEffect(() => {
    const unlock = () => {
      try {
        resumeAudio();
      } catch {
        /* no audio this session — the game itself is still fully playable */
      }
    };
    unlock();
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [slug]);

  /* No fullscreen request on purpose: entering fullscreen makes Chrome on Android show its
   * "to exit full screen, drag from the top…" banner on every game open, which players found
   * too intrusive. Landscape presentation on phones/tablets doesn't depend on fullscreen — it's
   * the pure-CSS rotation on ".force-landscape-wrapper" (index.css) + useFitScale. */

  if (!game || !game.component) {
    return <Navigate to="/" replace />;
  }

  const GameComponent = game.component;

  return (
    <div
      ref={pageRef}
      className="force-landscape-wrapper flex min-h-screen w-full items-center justify-center overflow-hidden bg-black"
    >
      <Suspense fallback={<div className="text-center text-white/70">Loading game...</div>}>
        <GameComponent />
      </Suspense>
      {contextLost && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-slate-950 px-10 text-center text-slate-100">
          <p className="text-lg font-bold">Something went wrong</p>
          <p className="text-sm text-slate-400">The game's graphics ran into a problem and couldn't continue.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-gradient-to-b from-amber-400 to-amber-500 px-6 py-2.5 text-sm font-semibold text-slate-950 hover:brightness-110"
          >
            Tap to reload
          </button>
        </div>
      )}
    </div>
  );
}
