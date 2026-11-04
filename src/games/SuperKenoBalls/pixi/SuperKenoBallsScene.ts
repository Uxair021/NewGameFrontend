import { Application, ColorMatrixFilter, Container, Graphics, Rectangle, Sprite, Text, type TextStyleOptions, Texture } from "pixi.js";
import { fixPointerMappingWhenRotated } from "../../shared/pixi/rotatedPointer";
import { createValuePulse } from "../../shared/pixi/valuePulse";
import { cubicBezier, keyframes, tween } from "../../shared/pixi/tween";
import {
  ballTexture,
  boardFrameTexture,
  bonusBannerTexture,
  backgroundTexture,
  cellTexture,
  railButtonTexture,
  railTexture,
  readoutPanelTexture,
  tankFloorTexture,
  titlebarTexture,
  type CellState,
} from "./textures";

/**
 * The whole cabinet is drawn on one fixed 1740x960 canvas, and the React side fit-scales the
 * canvas as a unit (same as every other game). Nothing here is DOM layout, so no screen size,
 * font fallback or browser zoom can push one panel into another.
 */
export const CANVAS_WIDTH = 1740;
export const CANVAS_HEIGHT = 960;

const FONT = "Arial, Helvetica, sans-serif";

// ---------- Layout (canvas px) ----------

const TITLE = { x: 10, y: 10, w: 1400, h: 80 };
const FRAME = { x: 10, y: 100, w: 1120, h: 850 };

const COLS = 10;
const CELL_W = 90;
const CELL_H = 85;
const CELL_GAP = 2;
const GRID_X = FRAME.x + (FRAME.w - (COLS * CELL_W + (COLS - 1) * CELL_GAP)) / 2;
const TOP_GRID_Y = FRAME.y + 24;
/** Laid out for the standard 80-ball pool: 4 rows per half. */
const ROWS_PER_HALF = 4;
const BANNER = { x: FRAME.x + 16, y: TOP_GRID_Y + ROWS_PER_HALF * CELL_H + 14, w: FRAME.w - 32, h: 94 };
const BOTTOM_GRID_Y = BANNER.y + BANNER.h + 14;

/** Ball tank, between the board frame and the cabinet's right edge. */
const TANK_CX = (FRAME.x + FRAME.w + TITLE.x + TITLE.w) / 2;
const FLOOR = { w: 200, h: 45, y: 902 };
const BALL = 74;
const BALL_PITCH = 80;
const BALL_COLS = 2;
/** Balls roll in along the titlebar's center line before dropping into the tank. */
const FLIGHT_Y = TITLE.y + TITLE.h / 2;
const FLIGHT_MS = 900;
const flightEase = cubicBezier(0.32, 0.6, 0.35, 1);

const RAIL = { x: 1430, y: 10, w: 300, h: 940 };
const RAIL_IN = { x: RAIL.x + 12, w: RAIL.w - 24 };
const HALF_BTN_W = (RAIL_IN.w - 6) / 2;
const RAIL_LEFT_CX = RAIL_IN.x + HALF_BTN_W / 2;
const RAIL_RIGHT_CX = RAIL_IN.x + RAIL_IN.w - HALF_BTN_W / 2;
const BTN_H = 75;
const STACK = { y: 105, h: 150, rowH: 50 };
const INFO = { y: 429, h: 426 };
const PAY_ROW_H = 32;

// ---------- Text styles ----------

const shadow = (color: string, dx: number, dy: number, alpha = 1, blur = 0) => ({
  color,
  alpha,
  blur,
  distance: Math.hypot(dx, dy),
  angle: Math.atan2(dy, dx),
});

const CELL_TEXT: Record<CellState, TextStyleOptions> = {
  idle: { fontFamily: FONT, fontSize: 42, fontWeight: "700", fill: "#ffffff", dropShadow: shadow("#000200", -4, 5, 0.3) },
  picked: { fontFamily: FONT, fontSize: 42, fontWeight: "700", fill: "#e60000", dropShadow: shadow("#8b0000", -4, 3, 0.35) },
  miss: { fontFamily: FONT, fontSize: 42, fontWeight: "700", fill: "#cbd5e1", dropShadow: shadow("#000200", -4, 5, 0.3) },
  hit: { fontFamily: FONT, fontSize: 42, fontWeight: "700", fill: "#ffe066", dropShadow: shadow("#000200", -4, 5, 0.3) },
};
const BALL_TEXT: TextStyleOptions = {
  fontFamily: FONT,
  fontSize: 50,
  fontWeight: "700",
  fill: "#16233d",
  stroke: { color: "#9d7f0f", width: 2 },
};
const BALL_HIT_TEXT: TextStyleOptions = { ...BALL_TEXT, fill: "#000000" };
const BTN_TEXT: TextStyleOptions = {
  fontFamily: FONT,
  fontSize: 30,
  fontWeight: "700",
  fill: "#fff500",
  align: "center",
  lineHeight: 30,
  dropShadow: shadow("#8a2100", 2, 2),
};
const BANNER_TEXT: TextStyleOptions = {
  fontFamily: FONT,
  fontSize: 38,
  fontWeight: "700",
  fill: "#ffb454",
  letterSpacing: 0.8,
  dropShadow: shadow("#000000", 0, 1, 0.6, 2),
};
const BANNER_STRONG: TextStyleOptions = { ...BANNER_TEXT, fontWeight: "900", fill: "#ffe066" };
const BANNER_WON: TextStyleOptions = { ...BANNER_TEXT, fill: "#ffe066", dropShadow: shadow("#ffe066", 0, 0, 0.75, 10) };
const BANNER_ERROR: TextStyleOptions = { ...BANNER_TEXT, fontSize: 32, fill: "#ff8a8a" };
const STACK_LABEL: TextStyleOptions = { fontFamily: FONT, fontSize: 28, fontWeight: "800", fill: "#ff6b6b", letterSpacing: 1.1 };
const STACK_VALUE: TextStyleOptions = { fontFamily: FONT, fontSize: 25, fontWeight: "700", fill: "#ffe066" };
const PAY_TEXT: TextStyleOptions = { fontFamily: FONT, fontSize: 25, fontWeight: "700", fill: "#ffe066" };
const PAY_ACTIVE_TEXT: TextStyleOptions = { ...PAY_TEXT, fill: "#fff5cf" };
const DIVIDER = { color: 0xcecfcf, alpha: 0.55, width: 1 };

export interface PaytableRowView {
  matches: number;
  payout: number;
  active: boolean;
}

/** Everything the scene draws, pushed from React on every state change. */
export interface SuperKenoBallsView {
  poolSize: number;
  picks: number[];
  /** Drawn numbers revealed so far, in draw order (the last of a full draw is the Bonus Ball). */
  revealed: number[];
  matched: number[];
  spinning: boolean;
  canPlay: boolean;
  balance: number;
  /** True while a win is counting up into CASH — the CASH value pulses meanwhile. */
  creditCounting: boolean;
  lastWin: number;
  bet: number;
  betAtMin: boolean;
  betAtMax: boolean;
  bonusMultiplier: number;
  bonusWon: boolean;
  paytable: PaytableRowView[];
  /** Error / warning shown in the bonus banner in place of the usual text. */
  message: string | null;
}

export interface SuperKenoBallsHandlers {
  onToggle(n: number): void;
  onWipe(): void;
  onQuickPick(): void;
  onBetChange(direction: 1 | -1): void;
  onPlay(): void;
  onExit(): void;
  onHelp(): void;
}

const hoverFilter = new ColorMatrixFilter();
hoverFilter.brightness(1.08, false);
const cellHoverFilter = new ColorMatrixFilter();
cellHoverFilter.brightness(1.1, false);
const pressFilter = new ColorMatrixFilter();
pressFilter.brightness(0.9, false);

function centeredText(text: string, style: TextStyleOptions, x = 0, y = 0) {
  const t = new Text({ text, style });
  t.anchor.set(0.5);
  t.position.set(x, y);
  return t;
}

/** Red rail button with hover/press feedback and an enabled state. */
class Button extends Container {
  private readonly face = new Container();
  private enabled = true;
  private hovered = false;
  private pressed = false;

  constructor(texture: Texture, content: Container[], onTap: () => void) {
    super();
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    this.face.addChild(sprite, ...content);
    this.addChild(this.face);
    this.hitArea = new Rectangle(-texture.width / 2, -texture.height / 2, texture.width, texture.height);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerover", () => ((this.hovered = true), this.refresh()));
    this.on("pointerout", () => ((this.hovered = false), (this.pressed = false), this.refresh()));
    this.on("pointerdown", () => ((this.pressed = true), this.refresh()));
    this.on("pointerup", () => ((this.pressed = false), this.refresh()));
    this.on("pointerupoutside", () => ((this.pressed = false), this.refresh()));
    this.on("pointertap", () => {
      if (this.enabled) onTap();
    });
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.eventMode = enabled ? "static" : "none";
    if (!enabled) this.hovered = this.pressed = false;
    this.refresh();
  }

  private refresh() {
    this.alpha = this.enabled ? 1 : 0.5;
    this.face.y = this.pressed ? 2 : 0;
    this.filters = this.pressed ? [pressFilter] : this.hovered ? [hoverFilter] : null;
  }
}

/** One square on the board. */
class Cell extends Container {
  state: CellState = "idle";
  private readonly sprite: Sprite;
  private readonly numberText: Text;
  private enabled = true;
  private hovered = false;
  private pressed = false;
  /** While the land-pop animation runs it owns `scale`. */
  animating = false;

  constructor(
    readonly n: number,
    private readonly textures: Record<CellState, Texture>,
    onTap: (n: number) => void
  ) {
    super();
    this.sprite = new Sprite(textures.idle);
    this.sprite.anchor.set(0.5);
    this.numberText = centeredText(String(n), CELL_TEXT.idle);
    this.addChild(this.sprite, this.numberText);
    this.hitArea = new Rectangle(-CELL_W / 2, -CELL_H / 2, CELL_W, CELL_H);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerover", () => ((this.hovered = true), this.refresh()));
    this.on("pointerout", () => ((this.hovered = false), (this.pressed = false), this.refresh()));
    this.on("pointerdown", () => ((this.pressed = true), this.refresh()));
    this.on("pointerup", () => ((this.pressed = false), this.refresh()));
    this.on("pointerupoutside", () => ((this.pressed = false), this.refresh()));
    this.on("pointertap", () => {
      if (this.enabled) onTap(this.n);
    });
  }

  get baseScale() {
    return this.state === "hit" ? 1.04 : 1;
  }

  setState(state: CellState) {
    this.state = state;
    this.sprite.texture = this.textures[state];
    this.numberText.style = CELL_TEXT[state];
    this.refresh();
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.eventMode = enabled ? "static" : "none";
    if (!enabled) this.hovered = this.pressed = false;
    this.refresh();
  }

  refresh() {
    this.zIndex = this.hovered ? 2 : this.state === "picked" || this.state === "hit" ? 1 : 0;
    this.filters = this.pressed ? [pressFilter] : this.hovered ? [cellHoverFilter] : null;
    if (this.animating) return;
    this.scale.set(this.baseScale * (this.hovered && this.state === "idle" ? 1.08 : 1));
  }
}

interface Ball {
  n: number;
  view: Container;
  sprite: Sprite;
  label: Text;
  hit: boolean;
}

export class SuperKenoBallsScene {
  private alive = true;
  private readonly isAlive = () => this.alive;
  private readonly ownedTextures: Texture[] = [];
  private readonly cellTextures: Record<CellState, Texture>;
  private readonly ballTextures: { plain: Texture; hit: Texture };

  private readonly board = new Container({ sortableChildren: true });
  private readonly cells = new Map<number, Cell>();
  private boardPoolSize = 0;

  private readonly bannerContent = new Container();
  private bannerKey = "";

  private readonly ballLayer = new Container();
  private balls: Ball[] = [];

  private readonly payRows = new Container();
  private paytableKey = "";

  private readonly cashValue: Text;
  private readonly cashPulse: ReturnType<typeof createValuePulse>;
  private readonly betValue: Text;
  private readonly winsValue: Text;
  private readonly picksValue: Text;

  private readonly wipeBtn: Button;
  private readonly betUpBtn: Button;
  private readonly quickBtn: Button;
  private readonly betDownBtn: Button;
  private readonly playBtn: Button;
  private readonly playCaption: Text;

  static async create(app: Application, handlers: () => SuperKenoBallsHandlers): Promise<SuperKenoBallsScene> {
    return new SuperKenoBallsScene(app, handlers);
  }

  private constructor(
    private readonly app: Application,
    private readonly handlers: () => SuperKenoBallsHandlers
  ) {
    const own = (t: Texture) => (this.ownedTextures.push(t), t);
    this.cellTextures = {
      idle: own(cellTexture("idle", CELL_W, CELL_H)),
      picked: own(cellTexture("picked", CELL_W, CELL_H)),
      hit: own(cellTexture("hit", CELL_W, CELL_H)),
      miss: own(cellTexture("miss", CELL_W, CELL_H)),
    };
    this.ballTextures = { plain: own(ballTexture(BALL, false)), hit: own(ballTexture(BALL, true)) };

    fixPointerMappingWhenRotated(app, CANVAS_WIDTH, CANVAS_HEIGHT);

    const stage = app.stage;
    const at = (tex: Texture, box: { x: number; y: number; w: number; h: number }) => {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.position.set(box.x + box.w / 2, box.y + box.h / 2);
      return s;
    };
    stage.addChild(new Sprite(own(backgroundTexture(CANVAS_WIDTH, CANVAS_HEIGHT))));

    // ---- Cabinet: title plaque, board frame, bonus banner, tank floor ----
    stage.addChild(
      at(own(titlebarTexture(TITLE.w, TITLE.h)), TITLE),
      centeredText(
        "SUPER KENO BALLS",
        {
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 42,
          fontWeight: "900",
          fill: "#ffffff",
          letterSpacing: 1,
          dropShadow: shadow("#000000", 2, 2),
        },
        TITLE.x + TITLE.w / 2,
        TITLE.y + TITLE.h / 2
      ),
      at(own(boardFrameTexture(FRAME.w, FRAME.h)), FRAME),
      at(own(bonusBannerTexture(BANNER.w, BANNER.h)), BANNER),
      this.bannerContent,
      this.board,
      at(own(tankFloorTexture(FLOOR.w, FLOOR.h)), { x: TANK_CX - FLOOR.w / 2, y: FLOOR.y, w: FLOOR.w, h: FLOOR.h })
    );
    this.bannerContent.position.set(BANNER.x + BANNER.w / 2, BANNER.y + BANNER.h / 2);

    // ---- Right rail ----
    stage.addChild(at(own(railTexture(RAIL.w, RAIL.h)), RAIL));
    const halfTex = own(railButtonTexture(HALF_BTN_W, BTN_H));
    const button = (lines: string, cx: number, top: number, onTap: () => void, arrows?: string) => {
      const content: Container[] = arrows
        ? [centeredText(arrows, { ...BTN_TEXT, fontSize: 14, letterSpacing: 1 }, 0, -14), centeredText(lines, BTN_TEXT, 0, 12)]
        : [centeredText(lines, BTN_TEXT)];
      const b = new Button(halfTex, content, onTap);
      b.position.set(cx, top + BTN_H / 2);
      stage.addChild(b);
      return b;
    };
    button("HELP", RAIL_LEFT_CX, 22, () => this.handlers().onHelp());
    button("EXIT", RAIL_RIGHT_CX, 22, () => this.handlers().onExit());

    // CASH / BET / WINS readouts.
    stage.addChild(at(own(readoutPanelTexture(RAIL_IN.w, STACK.h)), { x: RAIL_IN.x, y: STACK.y, w: RAIL_IN.w, h: STACK.h }));
    const readout = (label: string, centerY: number, labelColor?: string) => {
      const l = new Text({ text: label, style: labelColor ? { ...STACK_LABEL, fill: labelColor } : STACK_LABEL });
      l.anchor.set(0, 0.5);
      l.position.set(RAIL_IN.x + 10, centerY);
      const v = new Text({ text: "", style: STACK_VALUE });
      v.anchor.set(1, 0.5);
      v.position.set(RAIL_IN.x + RAIL_IN.w - 10, centerY + 2);
      stage.addChild(l, v);
      return v;
    };
    const dividers = new Graphics();
    for (let i = 0; i < 3; i++) {
      const y = STACK.y + (i + 1) * STACK.rowH - 1;
      if (i < 2) dividers.moveTo(RAIL_IN.x + 10, y).lineTo(RAIL_IN.x + RAIL_IN.w - 10, y);
    }
    this.cashValue = readout("CASH", STACK.y + STACK.rowH / 2);
    this.cashPulse = createValuePulse(this.app, this.cashValue, 0xffe066);
    this.betValue = readout("BET", STACK.y + STACK.rowH * 1.5, "#67e8f9");
    this.winsValue = readout("WINS", STACK.y + STACK.rowH * 2.5);

    this.wipeBtn = button("WIPE\nCARD", RAIL_LEFT_CX, 263, () => this.handlers().onWipe());
    this.betUpBtn = button("BET", RAIL_RIGHT_CX, 263, () => this.handlers().onBetChange(1), "▲▲");
    this.quickBtn = button("QUIK\nPICK", RAIL_LEFT_CX, 346, () => this.handlers().onQuickPick());
    this.betDownBtn = button("BET", RAIL_RIGHT_CX, 346, () => this.handlers().onBetChange(-1), "▼▼");

    // PICKS + live HITS/PAYS table.
    stage.addChild(at(own(readoutPanelTexture(RAIL_IN.w, INFO.h)), { x: RAIL_IN.x, y: INFO.y, w: RAIL_IN.w, h: INFO.h }));
    this.picksValue = readout("PICKS", INFO.y + 27);
    dividers.moveTo(RAIL_IN.x + 10, INFO.y + 53).lineTo(RAIL_IN.x + RAIL_IN.w - 10, INFO.y + 53);
    const headerY = INFO.y + 76;
    const hits = new Text({ text: "HITS", style: { ...PAY_TEXT, fontSize: 20 } });
    hits.anchor.set(0, 0.5);
    hits.position.set(RAIL_IN.x + 10, headerY);
    const pays = new Text({ text: "PAYS", style: { ...PAY_TEXT, fontSize: 20 } });
    pays.anchor.set(1, 0.5);
    pays.position.set(RAIL_IN.x + RAIL_IN.w - 10, headerY);
    dividers.moveTo(RAIL_IN.x + 10, headerY + 16).lineTo(RAIL_IN.x + RAIL_IN.w - 10, headerY + 16);
    dividers.stroke(DIVIDER);
    stage.addChild(dividers, hits, pays, this.payRows);

    const playTex = own(railButtonTexture(RAIL_IN.w, BTN_H));
    this.playCaption = centeredText("PLAY GAME", BTN_TEXT);
    this.playBtn = new Button(playTex, [this.playCaption], () => this.handlers().onPlay());
    this.playBtn.position.set(RAIL_IN.x + RAIL_IN.w / 2, RAIL.y + RAIL.h - 12 - BTN_H / 2);
    stage.addChild(this.playBtn);

    // Drawn balls fly over everything in the cabinet.
    stage.addChild(this.ballLayer);
  }

  private buildBoard(poolSize: number) {
    this.board.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.cells.clear();
    const half = poolSize / 2;
    for (let n = 1; n <= poolSize; n++) {
      const inBottom = n > half;
      const i = inBottom ? n - half - 1 : n - 1;
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cell = new Cell(n, this.cellTextures, (picked) => this.handlers().onToggle(picked));
      cell.position.set(
        GRID_X + col * (CELL_W + CELL_GAP) + CELL_W / 2,
        (inBottom ? BOTTOM_GRID_Y : TOP_GRID_Y) + row * CELL_H + CELL_H / 2
      );
      this.board.addChild(cell);
      this.cells.set(n, cell);
    }
    this.boardPoolSize = poolSize;
  }

  render(view: SuperKenoBallsView) {
    if (!this.alive) return;
    if (view.poolSize !== this.boardPoolSize) this.buildBoard(view.poolSize);

    // ---- Board ----
    const picked = new Set(view.picks);
    const revealed = new Set(view.revealed);
    const matched = new Set(view.matched);
    for (const cell of this.cells.values()) {
      const next: CellState = revealed.has(cell.n)
        ? matched.has(cell.n)
          ? "hit"
          : "miss"
        : picked.has(cell.n)
          ? "picked"
          : "idle";
      if (next !== cell.state) {
        const lands = next === "hit" || next === "miss";
        cell.setState(next);
        if (lands) void this.popCell(cell, next === "hit" ? 400 : 350);
      }
      cell.setEnabled(!view.spinning);
    }

    // ---- Draw ----
    this.syncBalls(view.revealed, matched);
    this.syncBanner(view);

    // ---- Rail ----
    this.cashValue.text = view.balance.toFixed(2);
    this.cashPulse.setActive(view.creditCounting);
    this.betValue.text = view.bet.toFixed(2);
    this.winsValue.text = view.lastWin.toFixed(2);
    this.picksValue.text = String(view.picks.length);
    this.syncPaytable(view.paytable);

    this.wipeBtn.setEnabled(!view.spinning);
    this.quickBtn.setEnabled(!view.spinning);
    this.betUpBtn.setEnabled(!view.spinning && !view.betAtMax);
    this.betDownBtn.setEnabled(!view.spinning && !view.betAtMin);
    this.playBtn.setEnabled(view.canPlay);
    this.playCaption.text = view.spinning ? "..." : "PLAY GAME";
  }

  private syncBanner(view: SuperKenoBallsView) {
    const kind = view.message ? `err:${view.message}` : view.bonusWon ? "won" : "info";
    const key = `${kind}:${view.bonusMultiplier}`;
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    this.bannerContent.removeChildren().forEach((c) => c.destroy());

    if (view.message) {
      this.bannerContent.addChild(centeredText(view.message, { ...BANNER_ERROR, wordWrap: true, wordWrapWidth: BANNER.w - 40, align: "center" }));
    } else if (view.bonusWon) {
      this.bannerContent.addChild(centeredText(`BONUS HIT — PAID ${view.bonusMultiplier}X!`, BANNER_WON));
    } else {
      // "LAST BALL IS THE **BONUS BALL**" / "PAYS 4X ON HIT"
      const a = new Text({ text: "LAST BALL IS THE ", style: BANNER_TEXT });
      const b = new Text({ text: "BONUS BALL", style: BANNER_STRONG });
      const lineW = a.width + b.width;
      a.anchor.set(0, 0.5);
      b.anchor.set(0, 0.5);
      a.position.set(-lineW / 2, -19);
      b.position.set(-lineW / 2 + a.width, -19);
      this.bannerContent.addChild(a, b, centeredText(`PAYS ${view.bonusMultiplier}X ON HIT`, BANNER_TEXT, 0, 19));
    }
  }

  /** The "land" pop when a drawn number reaches its square: 0.4 -> 1.15 -> 1. */
  private async popCell(cell: Cell, durationMs: number) {
    cell.animating = true;
    await tween(
      this.app.ticker,
      durationMs,
      (t) => {
        if (cell.destroyed) return;
        cell.scale.set(cell.baseScale * keyframes([[0, 0.4], [0.6, 1.15], [1, 1]], t));
        cell.alpha = keyframes([[0, 0.4], [0.6, 1], [1, 1]], t);
      },
      undefined,
      this.isAlive
    );
    if (cell.destroyed) return;
    cell.animating = false;
    cell.refresh();
  }

  private syncBalls(revealed: number[], matched: Set<number>) {
    // A new round (or a wiped card) empties the tank.
    const stillValid = this.balls.length <= revealed.length && this.balls.every((b, i) => b.n === revealed[i]);
    if (!stillValid) {
      this.ballLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.balls = [];
    }

    for (let i = this.balls.length; i < revealed.length; i++) {
      const n = revealed[i];
      const hit = matched.has(n);
      const view = new Container();
      const sprite = new Sprite(hit ? this.ballTextures.hit : this.ballTextures.plain);
      sprite.anchor.set(0.5);
      const label = centeredText(String(n), hit ? BALL_HIT_TEXT : BALL_TEXT);
      view.addChild(sprite, label);
      const slot = ballSlot(i);
      view.position.set(slot.x, slot.y);
      this.ballLayer.addChild(view);
      this.balls.push({ n, view, sprite, label, hit });
      void this.flyBall(view, slot);
    }

    for (const ball of this.balls) {
      const hit = matched.has(ball.n);
      if (hit !== ball.hit) {
        ball.hit = hit;
        ball.sprite.texture = hit ? this.ballTextures.hit : this.ballTextures.plain;
        ball.label.style = hit ? BALL_HIT_TEXT : BALL_TEXT;
      }
    }
  }

  /**
   * One continuous flight: the ball rolls in from the left along the title plaque, spinning,
   * until it's directly above its own column, then drops straight into its slot in the tank.
   */
  private async flyBall(ball: Container, slot: { x: number; y: number }) {
    const startX = TITLE.x - BALL / 2;
    await tween(
      this.app.ticker,
      FLIGHT_MS,
      (t) => {
        if (ball.destroyed) return;
        ball.position.set(
          keyframes([[0, startX], [0.06, startX], [0.55, slot.x], [1, slot.x]], t),
          keyframes([[0, FLIGHT_Y], [0.55, FLIGHT_Y], [0.85, slot.y], [1, slot.y]], t)
        );
        ball.angle = keyframes([[0, 0], [0.55, 720], [0.85, 990], [1, 1080]], t);
        ball.scale.set(keyframes([[0, 0.6], [0.06, 1], [0.55, 1], [0.85, 1.08], [1, 1]], t));
        ball.alpha = keyframes([[0, 0], [0.06, 1], [1, 1]], t);
      },
      flightEase,
      this.isAlive
    );
  }

  private syncPaytable(rows: PaytableRowView[]) {
    const key = JSON.stringify(rows);
    if (key === this.paytableKey) return;
    this.paytableKey = key;
    this.payRows.removeChildren().forEach((c) => c.destroy({ children: true }));

    const top = INFO.y + 104;
    if (rows.length === 0) {
      const hint = new Text({ text: "Pick numbers to see payouts", style: { fontFamily: FONT, fontSize: 14, fill: "#6b6f9c" } });
      hint.position.set(RAIL_IN.x + 10, top);
      this.payRows.addChild(hint);
      return;
    }

    rows.forEach((row, i) => {
      const cy = top + i * (PAY_ROW_H + 2) + PAY_ROW_H / 2;
      if (row.active) {
        this.payRows.addChild(
          new Graphics()
            .roundRect(RAIL_IN.x + 8, cy - PAY_ROW_H / 2, RAIL_IN.w - 16, PAY_ROW_H, 4)
            .fill({ color: 0xffe066, alpha: 0.18 })
        );
      }
      const style = row.active ? PAY_ACTIVE_TEXT : PAY_TEXT;
      const hits = new Text({ text: String(row.matches), style });
      hits.anchor.set(0, 0.5);
      hits.position.set(RAIL_IN.x + 12, cy);
      const pays = new Text({ text: row.payout.toLocaleString(), style });
      pays.anchor.set(1, 0.5);
      pays.position.set(RAIL_IN.x + RAIL_IN.w - 12, cy);
      this.payRows.addChild(hits, pays);
    });
  }

  destroy() {
    this.alive = false;
    this.cashPulse.destroy();
    for (const t of this.ownedTextures) t.destroy(true);
  }
}

/** Slot for the i-th drawn ball: 2 per row, piling up from the tank floor. */
function ballSlot(i: number) {
  const col = i % BALL_COLS;
  const row = Math.floor(i / BALL_COLS);
  return {
    x: TANK_CX + (col - (BALL_COLS - 1) / 2) * BALL_PITCH,
    y: FLOOR.y - 4 - BALL / 2 - row * BALL_PITCH,
  };
}
