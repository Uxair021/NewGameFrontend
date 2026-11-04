import { Application, CanvasSource, Sprite, Texture } from "pixi.js";

/**
 * The animated bg.webp played inside the Pixi canvas instead of as an HTML <img> behind it. An
 * animated <img> is its own compositor layer that Chrome re-rasters at screen size on every
 * animation frame (~8 MB+ of GPU memory for a full-screen layer); here only one decoded frame at
 * the file's own size (960x540, ~2 MB) is ever on the GPU, as a single texture updated in place.
 *
 * Frames are decoded one at a time, on demand, with the WebCodecs ImageDecoder — nothing is held
 * besides the current frame. Where ImageDecoder isn't available `create` returns null and the
 * game falls back to the <img> background (see FiveXRewindGame).
 */
export class BgAnimation {
  readonly sprite: Sprite;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly source: CanvasSource;
  private frameIndex = 0;
  /** How long the current frame stays up, and how long it's been up (ms). */
  private frameDurationMs = 0;
  private elapsedMs = 0;
  private decoding = false;
  private destroyed = false;
  private readonly tick = () => this.update();

  private constructor(
    private readonly app: Application,
    private readonly decoder: ImageDecoder,
    private readonly frameCount: number,
    first: VideoFrame,
    width: number,
    height: number
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = first.displayWidth;
    canvas.height = first.displayHeight;
    // CPU canvas: it's only the upload source for the texture, so it shouldn't also hold a GPU copy.
    this.ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    this.source = new CanvasSource({ resource: canvas });
    this.sprite = new Sprite(new Texture({ source: this.source }));
    this.sprite.width = width;
    this.sprite.height = height;
    this.showFrame(first);
    app.ticker.add(this.tick);
  }

  /** Loads `url` and starts playing it as a `width` x `height` sprite, or resolves null when the
   * browser can't decode it frame-by-frame (no ImageDecoder / unsupported type). */
  static async create(app: Application, url: string, width: number, height: number): Promise<BgAnimation | null> {
    if (typeof ImageDecoder === "undefined" || !(await ImageDecoder.isTypeSupported("image/webp"))) return null;
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`Failed to load background: ${url}`);
    const decoder = new ImageDecoder({ data: response.body, type: "image/webp" });
    try {
      await decoder.completed;
      const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;
      const { image } = await decoder.decode({ frameIndex: 0 });
      return new BgAnimation(app, decoder, frameCount, image, width, height);
    } catch (err) {
      decoder.close();
      throw err;
    }
  }

  /** Draws `frame` into the texture's canvas, re-uploads it, and frees the frame. */
  private showFrame(frame: VideoFrame): void {
    this.ctx.drawImage(frame, 0, 0);
    // VideoFrame.duration is in microseconds; fall back to ~30fps if the file doesn't say.
    this.frameDurationMs = frame.duration ? frame.duration / 1000 : 33;
    frame.close();
    this.source.update();
  }

  /** Advances on the app's ticker using each frame's own delay, decoding the next frame only when
   * it's due (and never two at once). */
  private update(): void {
    if (this.frameCount < 2 || this.decoding) return;
    this.elapsedMs += this.app.ticker.deltaMS;
    if (this.elapsedMs < this.frameDurationMs) return;
    this.elapsedMs -= this.frameDurationMs;
    // Skip the catch-up after a stall (e.g. a background tab) instead of fast-forwarding through it.
    if (this.elapsedMs > this.frameDurationMs) this.elapsedMs = 0;

    this.frameIndex = (this.frameIndex + 1) % this.frameCount;
    this.decoding = true;
    this.decoder
      .decode({ frameIndex: this.frameIndex })
      .then(({ image }) => {
        if (this.destroyed) image.close();
        else this.showFrame(image);
      })
      .catch(() => {
        /* a dropped frame — the next tick just tries the following one */
      })
      .finally(() => {
        this.decoding = false;
      });
  }

  destroy(): void {
    this.destroyed = true;
    this.app.ticker.remove(this.tick);
    this.decoder.close();
    this.sprite.destroy({ texture: true, textureSource: true });
  }
}
