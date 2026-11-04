import { Globe } from "lucide-react";

/**
 * Shown to visitors from a country the admin has blocked (admin dashboard → Overview → Country
 * block), on every URL, instead of the website. The server refuses all their requests as well, so
 * this is only the message — not the protection itself. Fits any screen, portrait or landscape.
 */
export function RegionBlockedPage() {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#050a1e] px-5 py-10 text-white supports-[height:100dvh]:min-h-[100dvh] [padding-bottom:max(2.5rem,env(safe-area-inset-bottom))] [padding-top:max(2.5rem,env(safe-area-inset-top))]">
      {/* soft glows */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-cyan-500/15 blur-3xl" />

      <div className="relative w-full max-w-lg rounded-3xl border border-amber-400/40 bg-gradient-to-b from-[#16244f]/90 to-[#0a1230]/90 p-7 text-center shadow-[0_0_40px_rgba(251,191,36,0.15)] backdrop-blur [@media(max-height:500px)]:p-5 sm:p-10">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border-2 border-amber-400/70 bg-amber-400/10 shadow-[0_0_24px_rgba(251,191,36,0.35)] [@media(max-height:500px)]:mb-3 [@media(max-height:500px)]:h-12 [@media(max-height:500px)]:w-12">
          <Globe className="h-8 w-8 text-amber-300 [@media(max-height:500px)]:h-6 [@media(max-height:500px)]:w-6" />
        </div>
        <h1 className="mb-2 text-2xl font-extrabold tracking-wide text-amber-300 [@media(max-height:500px)]:text-xl sm:text-3xl">
          Not available in your region
        </h1>
        <p className="text-sm text-white/70 sm:text-base">
          Sorry, this website isn&apos;t available in your country.
        </p>
      </div>
    </div>
  );
}
