/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cabinet: {
          green: "#0b3d24",
          "green-light": "#136b3f",
          gold: "#e8c15a",
        },
        // /home1 /home2 /home3 (ported from a separate GameFun project) — kept under its own
        // "brand" namespace so it can't collide with any of this app's existing color usage.
        brand: {
          green: "#8cc800",
          blue: "#0070dc",
          red: "#e60000",
          yellow: "#ffea00",
          orange: "#ff9f0a",
        },
      },
      fontFamily: {
        // Same reasoning as the `brand` colors above — scoped to /home1-3, not applied globally.
        ui: ['"Sora"', "ui-sans-serif", "system-ui", "sans-serif"],
        title: ['"Space Grotesk"', "ui-sans-serif", "system-ui", "sans-serif"],
        stats: ['"Rajdhani"', "ui-sans-serif", "system-ui", "sans-serif"],
        jackpot: ['"Orbitron"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      // The source GameFun project runs Tailwind v4, whose default spacing/max-width scales are
      // denser than v3's — these fill in the specific extra steps its /home1-3 markup uses (v3's
      // default scale skips straight from 14/16/20/24/28... with no 15/17/18/21/22/105) so those
      // classes resolve to the same pixel values here instead of silently doing nothing.
      spacing: {
        15: "3.75rem",
        17: "4.25rem",
        18: "4.5rem",
        21: "5.25rem",
        22: "5.5rem",
        105: "26.25rem",
      },
      maxWidth: {
        "8xl": "88rem",
      },
      keyframes: {
        "celebration-in": {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "60%": { opacity: "1", transform: "scale(1.08)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        sparkle: {
          "0%, 100%": { opacity: "0.4", transform: "scale(0.9)" },
          "50%": { opacity: "1", transform: "scale(1.15)" },
        },
        // Crazy777/SlotControlBar.tsx's 3D key-cap glow pulses (gold "spin" / red "stop" state).
        "scb-glow-y": {
          "0%, 100%": { boxShadow: "0 0 10px 2px rgba(255,200,40,.45), 0 6px 10px rgba(0,0,0,.75)" },
          "50%": { boxShadow: "0 0 26px 8px rgba(255,210,60,.85), 0 6px 10px rgba(0,0,0,.75)" },
        },
        "scb-glow-r": {
          "0%, 100%": { boxShadow: "0 0 10px 2px rgba(255,40,80,.45), 0 6px 10px rgba(0,0,0,.75)" },
          "50%": { boxShadow: "0 0 26px 8px rgba(255,60,100,.85), 0 6px 10px rgba(0,0,0,.75)" },
        },
        "scb-pop": {
          "0%": { transform: "scale(1.25)" },
          "100%": { transform: "scale(1)" },
        },
        "scb-win-flash": {
          "50%": { color: "#fff6a0", textShadow: "0 0 14px #ffd000, 0 2px 0 #3a2100" },
        },
        // shared/GameController.tsx — ported from the E:\Office Games\game-controller reference.
        // shared/GameController2.tsx — idle pulse (opacity overlay), WIN count-up pop, rocket flame.
        "gc2-pulse": {
          "0%, 100%": { opacity: "0" },
          "50%": { opacity: "1" },
        },
        "gc2-winpop": {
          to: { transform: "scale(1.07)" },
        },
        "gc2-flame": {
          to: { transform: "scaleY(1.35)" },
        },
        "gc-win-pop": {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.12)" },
          "100%": { transform: "scale(1)" },
        },
      },
      animation: {
        "celebration-in": "celebration-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        sparkle: "sparkle 1.4s ease-in-out infinite",
        "scb-glow-y": "scb-glow-y 1.6s ease-in-out infinite",
        "scb-glow-r": "scb-glow-r 1s ease-in-out infinite",
        "scb-pop": "scb-pop .3s ease-out",
        "scb-pop-slow": "scb-pop .35s ease-out",
        "scb-win-hit": "scb-pop .35s ease-out, scb-win-flash .5s ease-in-out 3",
        "gc-win-pop": "gc-win-pop 450ms ease-out",
        "gc2-pulse": "gc2-pulse 1.2s ease-in-out infinite",
        "gc2-winpop": "gc2-winpop .35s ease-in-out infinite alternate",
        "gc2-flame": "gc2-flame .12s linear infinite alternate",
      },
    },
  },
  plugins: [
    // `forced-landscape:` — applies while a page is CSS-rotated into landscape on a touch device
    // held in portrait (see .force-landscape-page in index.css; same media query). The viewport
    // still reports its narrow portrait width then, so sm:/lg: breakpoints don't fire; this lets
    // a rotated page opt into the layout it would get on a phone actually turned sideways.
    function ({ addVariant }) {
      addVariant("forced-landscape", "@media screen and (orientation: portrait) and (hover: none) and (pointer: coarse)");
    },
  ],
};
