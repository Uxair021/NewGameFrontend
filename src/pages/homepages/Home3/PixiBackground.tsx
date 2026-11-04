import { useEffect, useRef } from "react";
import { Application, Graphics } from "pixi.js";

interface Particle {
  gfx: Graphics;
  vy: number;
  vx: number;
}

/** Animated glowing particle field used behind the /home3 hero. */
export function PixiBackground({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let destroyed = false;
    const app = new Application();
    const particles: Particle[] = [];

    const glowColors = [0x00c8ff, 0x1677ff];

    async function setup() {
      await app.init({
        resizeTo: host!,
        backgroundAlpha: 0,
        antialias: true,
        powerPreference: "low-power",
      });

      if (destroyed) {
        app.destroy(true, { children: true });
        return;
      }

      host!.appendChild(app.canvas);

      const count = 60;
      for (let i = 0; i < count; i++) {
        const radius = Math.random() * 2 + 0.6;
        const g = new Graphics();
        const color = glowColors[i % glowColors.length];
        g.circle(0, 0, radius).fill({ color, alpha: Math.random() * 0.5 + 0.3 });
        g.x = Math.random() * app.screen.width;
        g.y = Math.random() * app.screen.height;

        particles.push({
          gfx: g,
          vy: Math.random() * 0.3 + 0.05,
          vx: (Math.random() - 0.5) * 0.15,
        });
        app.stage.addChild(g);
      }

      app.ticker.add(() => {
        for (const p of particles) {
          p.gfx.y -= p.vy;
          p.gfx.x += p.vx;
          if (p.gfx.y < -10) p.gfx.y = app.screen.height + 10;
          if (p.gfx.x < -10) p.gfx.x = app.screen.width + 10;
          if (p.gfx.x > app.screen.width + 10) p.gfx.x = -10;
        }
      });
    }

    setup();

    return () => {
      destroyed = true;
      try {
        app.destroy(true, { children: true });
      } catch {
        /* app was never fully initialized */
      }
    };
  }, []);

  return <div ref={hostRef} className={`absolute inset-0 ${className}`} />;
}
