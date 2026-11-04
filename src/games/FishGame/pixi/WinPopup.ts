import { Container, Text, TextStyle } from "pixi.js";

const LIFETIME_MS = 900;
const RISE_DISTANCE = 70; // px the text drifts upward over its lifetime
const START_SCALE = 0.4;
const PEAK_SCALE = 1.15; // briefly overshoots past 1x on the way in, like a little "pop"
const POP_DURATION_MS = 160; // how long the pop-in takes before settling in to drift/fade

const TEXT_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "900",
  fontSize: 44,
  fill: 0xffd700,
  stroke: { color: 0x7a3e00, width: 7 },
  align: "center",
});

/**
 * The floating "+12.50" that pops up wherever a creature was just caught, showing the amount the
 * server actually credited for that catch — pops in with a little overshoot, drifts upward,
 * fades out. Driven the same way as HitEffect: FishGameScene calls update(deltaMS) every tick and
 * removes it once isFinished() is true.
 */
export class WinPopup extends Container {
  private elapsed = 0;
  private text: Text;

  constructor(x: number, y: number, winAmount: number) {
    super();
    this.x = x;
    this.y = y;

    this.text = new Text({ text: `+${winAmount.toFixed(2)}`, style: TEXT_STYLE });
    this.text.anchor.set(0.5);
    this.addChild(this.text);
    this.scale.set(START_SCALE);
  }

  update(deltaMS: number): void {
    this.elapsed += deltaMS;
    const t = Math.min(1, this.elapsed / LIFETIME_MS);

    if (this.elapsed < POP_DURATION_MS) {
      const popT = this.elapsed / POP_DURATION_MS;
      const eased = 1 - (1 - popT) * (1 - popT);
      this.scale.set(START_SCALE + (PEAK_SCALE - START_SCALE) * eased);
    } else {
      this.scale.set(PEAK_SCALE - (PEAK_SCALE - 1) * Math.min(1, (this.elapsed - POP_DURATION_MS) / 200));
    }

    this.y -= (RISE_DISTANCE * deltaMS) / LIFETIME_MS;
    this.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  }

  isFinished(): boolean {
    return this.elapsed >= LIFETIME_MS;
  }
}
