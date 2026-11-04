import { Sprite, Texture, Ticker } from "pixi.js";

/** Loads plain <img> elements (fully decoded) WITHOUT creating Pixi textures — frames kept this
 * way live in ordinary memory, never on the GPU. */
export function loadImages(urls: string[]): Promise<HTMLImageElement[]> {
  return Promise.all(
    urls.map(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    })
  );
}

/**
 * A frame-by-frame animation that costs the GPU just ONE frame's worth of texture memory.
 *
 * A PIXI.AnimatedSprite uploads every frame as its own GPU texture (27 fairy frames ≈ 18MB+ of
 * GPU memory). Instead, this draws the current frame onto a single small 2D canvas (a software
 * canvas, so the frames themselves stay in ordinary memory) and re-uploads only that canvas when
 * the frame changes — a few hundred KB of GPU memory however many frames there are. Uploading one
 * small frame ~24-30 times a second is trivial for any GPU.
 */
export class Flipbook {
  readonly sprite: Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Texture;
  private elapsedMs = 0;
  private current = -1;
  private playing = false;

  constructor(
    private readonly frames: HTMLImageElement[],
    private readonly fps: number
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = frames[0].naturalWidth;
    this.canvas.height = frames[0].naturalHeight;
    // willReadFrequently keeps this a CPU canvas — a GPU-accelerated 2D canvas would cache the
    // frames on the GPU itself and defeat the point.
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    this.texture = Texture.from(this.canvas);
    this.sprite = new Sprite(this.texture);
    this.draw(0);
  }

  get width(): number {
    return this.canvas.width;
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    Ticker.shared.add(this.tick);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    Ticker.shared.remove(this.tick);
  }

  destroy(): void {
    this.stop();
    this.sprite.destroy();
    this.texture.destroy(true);
  }

  private tick = (ticker: Ticker): void => {
    this.elapsedMs += ticker.deltaMS;
    const index = Math.floor((this.elapsedMs * this.fps) / 1000) % this.frames.length;
    if (index !== this.current) this.draw(index);
  };

  private draw(index: number): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.frames[index], 0, 0, this.canvas.width, this.canvas.height);
    this.texture.source.update();
    this.current = index;
  }
}
