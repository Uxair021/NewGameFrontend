import { useEffect, useState } from "react";

interface Glow {
  id: number;
  x: number;
  y: number;
}

let idCounter = 0;

/** A brief golden pulse at every click point on the page — purely cosmetic, ported as-is. */
export function ClickGlow() {
  const [glows, setGlows] = useState<Glow[]>([]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const id = ++idCounter;
      setGlows((prev) => [...prev, { id, x: e.clientX, y: e.clientY }]);
      window.setTimeout(() => {
        setGlows((prev) => prev.filter((g) => g.id !== id));
      }, 650);
    };

    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
      {glows.map((g) => (
        <span
          key={g.id}
          className="homepages-click-glow absolute rounded-full"
          style={{
            left: g.x,
            top: g.y,
            width: 56,
            height: 56,
            marginLeft: -28,
            marginTop: -28,
            background: "radial-gradient(circle, rgba(255,234,0,0.9) 0%, rgba(255,159,10,0.5) 45%, transparent 70%)",
            boxShadow: "0 0 20px 6px rgba(255,234,0,0.6)",
          }}
        />
      ))}
    </div>
  );
}
