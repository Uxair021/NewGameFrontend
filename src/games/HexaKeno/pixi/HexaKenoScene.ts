import {
  Application,
  ColorMatrixFilter,
  Container,
  Graphics,
  Polygon,
  Sprite,
  Text,
  type TextStyleOptions,
  Texture,
} from "pixi.js";
import { fixPointerMappingWhenRotated } from "../../shared/pixi/rotatedPointer";
import { makeFittedTexture } from "../../shared/pixi/scaledTexture";
import { createValuePulse } from "../../shared/pixi/valuePulse";
import { easeOutCubic, keyframes, tween } from "../../shared/pixi/tween";
import {
  actionButtonTexture,
  backgroundTexture,
  ballTexture,
  bevelButtonTexture,
  blackBoxTexture,
  hexTexture,
  ovalButtonTexture,
  paytableRowTexture,
  railTexture,
  type CellState,
} from "./textures";

/**
 * The whole cabinet is drawn on one fixed 1600x900 canvas, and the React side fit-scales the
 * canvas as a unit (same as every other game). Nothing here is DOM layout, so no screen size,
 * font fallback or browser zoom can push one panel into another.
 */
export const CANVAS_WIDTH = 1600;
export const CANVAS_HEIGHT = 900;

const FONT = "Arial, Helvetica, sans-serif";
const PORT_URL = "/symbols/hexaKeno/shape-shape.png";

// ---------- Layout (canvas px) ----------

const COLS = 10;
const LAYOUT_ROWS = 8;
const CELL_H = 88;
const CELL_W = CELL_H * 1.5;
/** Neighboring columns overlap by 40% of a cell height so the pointed sides interlock. */
const COL_PITCH = CELL_W - CELL_H * 0.4;
const BOARD_W = (COLS - 1) * COL_PITCH + CELL_W;
const BOARD_H = (LAYOUT_ROWS + 0.5) * CELL_H;
const BOARD_CENTER_X = 825;
const BOARD_X = BOARD_CENTER_X - BOARD_W / 2;
const BOARD_Y = 18;

const LEFT_X = 12;
const PORT_W = 250;
const PORT_H = (PORT_W * 1577) / 997;
const PORT_Y = 10;
/** Black interior of shape-shape.png, as fractions of the image. */
const PORT_INNER = { left: 0.048, right: 0.807, bottom: 0.973 };
/** Where the chute in the port's top-right notch opens — every ball falls in from here. */
const CHUTE = { x: LEFT_X + PORT_W * 0.86, y: PORT_Y + PORT_H * 0.06 };
const BALL = 48;
const BALL_PITCH = 52;
const BALL_COLS = 3;

const PAYTABLE = { x: LEFT_X, y: 418, w: 230, h: 392 };
const PAY_ROW_H = 30;
const PAY_ROW_GAP = 3;
const PICKS_BOX = { x: LEFT_X, y: 822, w: 230, h: 68 };

const RAIL = { x: 1388, y: 10, w: 200, h: 880 };
const RAIL_CX = RAIL.x + RAIL.w / 2;
/** Section boundaries down the rail, in canvas y. */
const RAIL_DIVIDERS = [190, 280, 370, 450, 550, 760];
const RAIL_BTN_W = RAIL.w - 24;

const ACTIONS = { y: 786, h: 96, left: 285, right: 1365, btnW: 130, gap: 15 };

// ---------- Text styles ----------

const CELL_TEXT: TextStyleOptions = {
  fontFamily: FONT,
  fontSize: 40,
  fontWeight: "700",
  fill: "#ffc7c7",
  stroke: { color: "#bd4f3b", width: 4 },
  dropShadow: { color: "#ff5f3c", alpha: 0.95, blur: 5, distance: 0 },
};
const BALL_TEXT: TextStyleOptions = {
  fontFamily: FONT,
  fontSize: 30,
  fontWeight: "900",
  fill: "#ffea29",
  stroke: { color: "#ff0000", width: 4 },
};
const BALL_HIT_TEXT: TextStyleOptions = { ...BALL_TEXT, fill: "#49ddff", stroke: { color: "#10057c", width: 4 } };
const LETTER_TEXT: TextStyleOptions = {
  fontFamily: FONT,
  fontSize: 25,
  fontWeight: "700",
  fill: "#ffb98a",
  dropShadow: { color: "#ff8a3d", alpha: 0.85, blur: 6, distance: 0 },
};
const GOLD_HEADER: TextStyleOptions = { fontFamily: FONT, fontSize: 15, fontWeight: "800", fill: "#ffe066", letterSpacing: 1.5 };
const PAY_ROW_TEXT: TextStyleOptions = { fontFamily: FONT, fontSize: 18, fontWeight: "700", fill: "#cfd0e8" };
const PAY_ROW_ACTIVE_TEXT: TextStyleOptions = { ...PAY_ROW_TEXT, fill: "#ffe066" };
const NEON_LABEL: TextStyleOptions = {
  fontFamily: FONT,
  fontSize: 22,
  fontWeight: "500",
  fill: "#66ff00",
  letterSpacing: 0.7,
  dropShadow: { color: "#39ff14", alpha: 1, blur: 2, distance: 0 },
};
const CYAN_VALUE: TextStyleOptions = { fontFamily: FONT, fontSize: 22, fontWeight: "700", fill: "#6fe0ff" };
const GREEN_BTN_TEXT: TextStyleOptions = {
  fontFamily: FONT,
  fontSize: 22,
  fontWeight: "900",
  fill: "#39ff52",
  letterSpacing: 1,
  dropShadow: { color: "#08751a", alpha: 1, blur: 0, distance: 1.4, angle: Math.PI / 4 },
};
const BANNER_TEXT: TextStyleOptions = {
  fontFamily: FONT,
  fontSize: 20,
  fontWeight: "700",
  fill: "#fde047",
  letterSpacing: 1,
  align: "center",
};
const ERROR_COLOR = "#ff8a7a";

export interface PaytableRowView {
  matches: number;
  payout: number;
  active: boolean;
}

/** Everything the scene draws, pushed from React on every state change. */
export interface HexaKenoView {
  poolSize: number;
  maxPicks: number;
  picks: number[];
  /** Drawn numbers revealed so far, in draw order. */
  revealed: number[];
  matched: number[];
  spinning: boolean;
  canPlay: boolean;
  balance: number;
  /** True while a win is counting up into CREDIT — the CREDIT value pulses meanwhile. */
  creditCounting: boolean;
  lastWin: number;
  bet: number;
  betAtMin: boolean;
  betAtMax: boolean;
  paytable: PaytableRowView[];
  /** Error / warning shown in the bottom banner in place of the usual hint. */
  message: string | null;
}

export interface HexaKenoHandlers {
  onToggle(n: number): void;
  onClear(): void;
  onQuickPick(): void;
  onBetChange(direction: 1 | -1): void;
  onMaxBet(): void;
  onPlay(): void;
  onExit(): void;
  onHelp(): void;
}

const hoverFilter = new ColorMatrixFilter();
hoverFilter.brightness(1.15, false);

/** A sprite button with hover/press feedback and an enabled state. */
class Button extends Container {
  private readonly caption: Text | null;
  private enabled = true;
  private hovered = false;
  private pressed = false;

  constructor(
    texture: Texture,
    text: string,
    style: TextStyleOptions,
    onTap: () => void,
    private readonly disabledAlpha = 0.5
  ) {
    super();
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    this.addChild(sprite);
    this.caption = text ? new Text({ text, style }) : null;
    if (this.caption) {
      this.caption.anchor.set(0.5);
      this.addChild(this.caption);
    }
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

  setCaption(text: string) {
    if (this.caption && this.caption.text !== text) this.caption.text = text;
  }

  private refresh() {
    this.alpha = this.enabled ? 1 : this.disabledAlpha;
    this.scale.set(this.pressed ? 0.98 : this.hovered ? 1.03 : 1);
    this.filters = this.hovered && !this.pressed ? [hoverFilter] : null;
  }
}

/** One hex on the board. */
class Cell extends Container {
  state: CellState = "idle";
  private readonly sprite: Sprite;
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
    const label = new Text({ text: String(n), style: CELL_TEXT });
    label.anchor.set(0.5);
    this.addChild(this.sprite, label);

    // Exact hex hit shape, so the padded glow texture never steals a neighbor's click.
    const w = CELL_W / 2;
    const h = CELL_H / 2;
    this.hitArea = new Polygon([-w / 2, -h, w / 2, -h, w, 0, w / 2, h, -w / 2, h, -w, 0]);
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
    return this.state === "picked" ? 1.05 : 1;
  }

  setState(state: CellState) {
    this.state = state;
    this.sprite.texture = this.textures[state];
    this.refresh();
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.eventMode = enabled ? "static" : "none";
    this.cursor = enabled ? "pointer" : "default";
    if (!enabled) this.hovered = this.pressed = false;
    this.refresh();
  }

  refresh() {
    this.zIndex = this.hovered ? 2 : this.state === "picked" ? 1 : 0;
    this.filters = this.hovered && !this.pressed ? [hoverFilter] : null;
    if (this.animating) return;
    const hover = this.pressed ? 0.98 : this.hovered ? (this.state === "idle" ? 1.08 : 1.03) : 1;
    this.scale.set(this.baseScale * hover);
  }
}

interface Ball {
  n: number;
  view: Container;
  label: Text;
  hit: boolean;
}

export class HexaKenoScene {
  private alive = true;
  private readonly creditPulse: ReturnType<typeof createValuePulse>;
  private readonly isAlive = () => this.alive;
  private readonly ownedTextures: Texture[] = [];
  private readonly hexTextures: Record<CellState, Texture>;
  private readonly ballTex: Texture;
  private readonly payRowTex: { normal: Texture; active: Texture };

  private readonly board = new Container({ sortableChildren: true });
  private readonly cells = new Map<number, Cell>();
  private boardPoolSize = 0;

  private readonly feed = new Container();
  private balls: Ball[] = [];

  private readonly paytableRows = new Container();
  private paytableKey: string | null = null;

  private readonly creditValue: Text;
  private readonly winsValue: Text;
  private readonly picksValue: Text;
  private readonly betValue: Text;
  private readonly picksBoxText: Text;
  private readonly bannerText: Text;

  private readonly clearBtn: Button;
  private readonly quickBtn: Button;
  private readonly maxBetBtn: Button;
  private readonly minusBtn: Button;
  private readonly plusBtn: Button;
  private readonly playBtn: Button;

  static async create(app: Application, handlers: () => HexaKenoHandlers): Promise<HexaKenoScene> {
    // The port art is 997x1577 but only ever drawn PORT_W x PORT_H, so upload just that size
    // (~0.4 MB of GPU memory instead of ~6.3 MB at full size).
    const img = new Image();
    img.src = PORT_URL;
    await img.decode();
    return new HexaKenoScene(app, handlers, makeFittedTexture(img, Math.ceil(PORT_H)));
  }

  private constructor(
    private readonly app: Application,
    private readonly handlers: () => HexaKenoHandlers,
    portTexture: Texture
  ) {
    const own = (t: Texture) => (this.ownedTextures.push(t), t);
    this.hexTextures = {
      idle: own(hexTexture("idle", CELL_W, CELL_H)),
      picked: own(hexTexture("picked", CELL_W, CELL_H)),
      hit: own(hexTexture("hit", CELL_W, CELL_H)),
      miss: own(hexTexture("miss", CELL_W, CELL_H)),
    };
    this.ballTex = own(ballTexture(BALL));
    this.payRowTex = {
      normal: own(paytableRowTexture(PAYTABLE.w - 20, PAY_ROW_H, false)),
      active: own(paytableRowTexture(PAYTABLE.w - 20, PAY_ROW_H, true)),
    };

    fixPointerMappingWhenRotated(app, CANVAS_WIDTH, CANVAS_HEIGHT);

    const stage = app.stage;
    stage.addChild(new Sprite(own(backgroundTexture(CANVAS_WIDTH, CANVAS_HEIGHT))));

    // ---- Left: draw feed port ----
    const port = new Sprite(own(portTexture));
    port.position.set(LEFT_X, PORT_Y);
    port.width = PORT_W;
    port.height = PORT_H;
    stage.addChild(port, this.feed);

    // ---- Left: paytable ----
    const payPanel = new Graphics()
      .roundRect(PAYTABLE.x, PAYTABLE.y, PAYTABLE.w, PAYTABLE.h, 16)
      .stroke({ color: 0xffd166, alpha: 0.3, width: 1 });
    const hitHeader = new Text({ text: "HIT", style: GOLD_HEADER });
    hitHeader.position.set(PAYTABLE.x + 14, PAYTABLE.y + 12);
    const paysHeader = new Text({ text: "PAYS", style: GOLD_HEADER });
    paysHeader.anchor.set(1, 0);
    paysHeader.position.set(PAYTABLE.x + PAYTABLE.w - 14, PAYTABLE.y + 12);
    stage.addChild(payPanel, hitHeader, paysHeader, this.paytableRows);

    const picksBox = new Sprite(own(blackBoxTexture(PICKS_BOX.w, PICKS_BOX.h)));
    picksBox.position.set(PICKS_BOX.x, PICKS_BOX.y);
    this.picksBoxText = new Text({
      text: "",
      style: { fontFamily: FONT, fontSize: 30, fontWeight: "700", fill: "#ffffff" },
    });
    this.picksBoxText.alpha = 0.5;
    this.picksBoxText.anchor.set(0.5);
    this.picksBoxText.position.set(PICKS_BOX.x + PICKS_BOX.w / 2, PICKS_BOX.y + PICKS_BOX.h / 2);
    stage.addChild(picksBox, this.picksBoxText);

    // ---- Center: board + HEXAKENO framing letters ----
    stage.addChild(this.board);
    this.addBoardLetters();

    // ---- Center bottom: CLEAR CARD / banner / QUICK PICK ----
    const actionTex = own(actionButtonTexture(ACTIONS.btnW, ACTIONS.h));
    const actionStyle: TextStyleOptions = {
      fontFamily: FONT,
      fontSize: 20,
      fontWeight: "800",
      fill: "#f7ca06",
      align: "center",
      lineHeight: 22,
    };
    const actionCy = ACTIONS.y + ACTIONS.h / 2;
    this.clearBtn = new Button(actionTex, "CLEAR\nCARD", actionStyle, () => handlers().onClear());
    this.clearBtn.position.set(ACTIONS.left + ACTIONS.btnW / 2, actionCy);
    this.quickBtn = new Button(actionTex, "QUICK\nPICK", actionStyle, () => handlers().onQuickPick());
    this.quickBtn.position.set(ACTIONS.right - ACTIONS.btnW / 2, actionCy);

    const bannerX = ACTIONS.left + ACTIONS.btnW + ACTIONS.gap;
    const bannerW = ACTIONS.right - ACTIONS.btnW - ACTIONS.gap - bannerX;
    const banner = new Sprite(own(blackBoxTexture(bannerW, ACTIONS.h, true)));
    banner.anchor.set(0.5);
    banner.position.set(bannerX + bannerW / 2, actionCy);
    this.bannerText = new Text({ text: "", style: { ...BANNER_TEXT, wordWrap: true, wordWrapWidth: bannerW - 40 } });
    this.bannerText.anchor.set(0.5);
    this.bannerText.position.copyFrom(banner.position);
    stage.addChild(banner, this.bannerText, this.clearBtn, this.quickBtn);

    // ---- Right: control rail ----
    const rail = new Sprite(own(railTexture(RAIL.w, RAIL.h, RAIL_DIVIDERS.map((y) => y - RAIL.y))));
    rail.anchor.set(0.5);
    rail.position.set(RAIL_CX, RAIL.y + RAIL.h / 2);
    stage.addChild(rail);

    const ovalTex = own(ovalButtonTexture(141, 70));
    const ovalStyle: TextStyleOptions = { fontFamily: FONT, fontSize: 22, fontWeight: "700", fill: "#39ff52" };
    const exitBtn = new Button(ovalTex, "EXIT", ovalStyle, () => handlers().onExit());
    exitBtn.position.set(RAIL_CX, 60);
    const helpBtn = new Button(ovalTex, "HELP", ovalStyle, () => handlers().onHelp());
    helpBtn.position.set(RAIL_CX, 140);

    const label = (text: string, y: number, style: TextStyleOptions) => {
      const t = new Text({ text, style });
      t.anchor.set(0.5);
      t.position.set(RAIL_CX, y);
      stage.addChild(t);
      return t;
    };
    label("CREDIT", 218, NEON_LABEL);
    this.creditValue = label("", 254, CYAN_VALUE);
    this.creditPulse = createValuePulse(this.app, this.creditValue, 0x6fe0ff);
    label("WINS", 308, NEON_LABEL);
    this.winsValue = label("", 344, CYAN_VALUE);
    label("PICKS", 395, { ...NEON_LABEL, fontSize: 18 });
    this.picksValue = label("", 425, { fontFamily: FONT, fontSize: 22, fontWeight: "700", fill: "#f3f3f3" });

    const redTex = own(bevelButtonTexture(RAIL_BTN_W, 75, "red"));
    this.maxBetBtn = new Button(redTex, "MAX BET", GREEN_BTN_TEXT, () => handlers().onMaxBet());
    this.maxBetBtn.position.set(RAIL_CX, 500);

    const stepTex = own(bevelButtonTexture(RAIL_BTN_W, 55, "stepper"));
    const stepStyle: TextStyleOptions = {
      fontFamily: FONT,
      fontSize: 40,
      fontWeight: "800",
      fill: "#66ff00",
      dropShadow: { color: "#004400", alpha: 1, blur: 2, distance: 1.4, angle: Math.PI / 4 },
    };
    this.minusBtn = new Button(stepTex, "−", stepStyle, () => handlers().onBetChange(-1), 0.4);
    this.minusBtn.position.set(RAIL_CX, 593);
    this.betValue = label("", 655, CYAN_VALUE);
    this.plusBtn = new Button(stepTex, "+", stepStyle, () => handlers().onBetChange(1), 0.4);
    this.plusBtn.position.set(RAIL_CX, 717);

    this.playBtn = new Button(redTex, "PLAY GAME", GREEN_BTN_TEXT, () => handlers().onPlay());
    this.playBtn.position.set(RAIL_CX, 825);

    stage.addChild(exitBtn, helpBtn, this.maxBetBtn, this.minusBtn, this.plusBtn, this.playBtn);
  }

  private addBoardLetters() {
    const add = (ch: string, x: number, y: number) => {
      const t = new Text({ text: ch, style: LETTER_TEXT });
      t.anchor.set(0.5);
      t.position.set(x, y);
      this.app.stage.addChild(t);
    };
    // Down the left edge, in the notches between column 0's (offset) hexes.
    "HEXAKENO".split("").forEach((ch, k) => add(ch, BOARD_X + 10, BOARD_Y + CELL_H / 2 + k * CELL_H));
    // Down the right edge, in the notches between column 9's hexes.
    "HEXAKENO".split("").forEach((ch, k) => add(ch, BOARD_X + BOARD_W - 10, BOARD_Y + (k + 1) * CELL_H));
    // "HEXA" in the half-cell gaps above the offset columns, "KENO" in the gaps below the others.
    "HEXA".split("").forEach((ch, k) => add(ch, cellCenterX(2 + k * 2), BOARD_Y + CELL_H / 4));
    "KENO".split("").forEach((ch, k) => add(ch, cellCenterX(1 + k * 2), BOARD_Y + BOARD_H - CELL_H / 4));
  }

  private buildBoard(poolSize: number) {
    this.board.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.cells.clear();
    const rows = Math.ceil(poolSize / COLS);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < rows; r++) {
        const n = c + 1 + r * COLS;
        if (n > poolSize) continue;
        const cell = new Cell(n, this.hexTextures, (picked) => this.handlers().onToggle(picked));
        cell.position.set(cellCenterX(c), BOARD_Y + r * CELL_H + (c % 2 === 0 ? CELL_H / 2 : 0) + CELL_H / 2);
        this.board.addChild(cell);
        this.cells.set(n, cell);
      }
    }
    this.boardPoolSize = poolSize;
  }

  render(view: HexaKenoView) {
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

    // ---- Draw feed ----
    this.syncFeed(view.revealed, matched);

    // ---- Paytable ----
    this.syncPaytable(view.paytable);
    this.picksBoxText.text = `PICKS ${view.maxPicks}`;

    // ---- Rail readouts ----
    this.creditValue.text = `$ ${view.balance.toFixed(2)}`;
    this.creditPulse.setActive(view.creditCounting);
    this.winsValue.text = `$ ${view.lastWin.toFixed(2)}`;
    this.picksValue.text = `${view.picks.length}/${view.maxPicks}`;
    this.betValue.text = view.bet.toFixed(2);

    // ---- Buttons ----
    this.clearBtn.setEnabled(!view.spinning);
    this.quickBtn.setEnabled(!view.spinning);
    this.maxBetBtn.setEnabled(!view.spinning);
    this.minusBtn.setEnabled(!view.spinning && !view.betAtMin);
    this.plusBtn.setEnabled(!view.spinning && !view.betAtMax);
    this.playBtn.setEnabled(view.canPlay);
    this.playBtn.setCaption(view.spinning ? "..." : "PLAY GAME");

    // ---- Banner ----
    this.bannerText.text = view.message ?? `SELECT MAX ${view.maxPicks} NUMBERS CHOOSE A NEW CARD`;
    this.bannerText.style.fill = view.message ? ERROR_COLOR : "#fde047";
    this.bannerText.alpha = view.message ? 1 : 0.7;
  }

  /** The "land" pop when a drawn number reaches its hex: 0.4 -> 1.15 -> 1. */
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

  private syncFeed(revealed: number[], matched: Set<number>) {
    // A new round (or a cleared card) restarts the pile from the floor of the port.
    const stillValid = this.balls.length <= revealed.length && this.balls.every((b, i) => b.n === revealed[i]);
    if (!stillValid) {
      this.feed.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.balls = [];
    }

    for (let i = this.balls.length; i < revealed.length; i++) {
      const n = revealed[i];
      const view = new Container();
      const sprite = new Sprite(this.ballTex);
      sprite.anchor.set(0.5);
      const label = new Text({ text: String(n), style: matched.has(n) ? BALL_HIT_TEXT : BALL_TEXT });
      label.anchor.set(0.5);
      view.addChild(sprite, label);
      const slot = ballSlot(i);
      view.position.set(slot.x, slot.y);
      this.feed.addChild(view);
      this.balls.push({ n, view, label, hit: matched.has(n) });
      void this.dropBall(view, slot);
    }

    for (const ball of this.balls) {
      const hit = matched.has(ball.n);
      if (hit !== ball.hit) {
        ball.hit = hit;
        ball.label.style = hit ? BALL_HIT_TEXT : BALL_TEXT;
      }
    }
  }

  /** Ball drops out of the chute in the port's notch, overshoots and settles into its slot. */
  private async dropBall(ball: Container, slot: { x: number; y: number }) {
    const fromX = CHUTE.x - slot.x;
    const fromY = CHUTE.y - slot.y;
    await tween(
      this.app.ticker,
      550,
      (t) => {
        if (ball.destroyed) return;
        const dx = keyframes([[0, fromX], [0.55, -6], [0.75, 2], [1, 0]], t);
        const dy = keyframes([[0, fromY], [0.55, 8], [0.75, -4], [1, 0]], t);
        ball.position.set(slot.x + dx, slot.y + dy);
        ball.scale.set(keyframes([[0, 0.7], [0.55, 1.06], [0.75, 0.97], [1, 1]], t));
        ball.alpha = keyframes([[0, 0], [0.55, 1], [1, 1]], t);
      },
      easeOutCubic,
      this.isAlive
    );
  }

  private syncPaytable(rows: PaytableRowView[]) {
    const key = JSON.stringify(rows);
    if (key === this.paytableKey) return;
    this.paytableKey = key;
    this.paytableRows.removeChildren().forEach((c) => c.destroy({ children: true }));

    const top = PAYTABLE.y + 40;
    if (rows.length === 0) {
      const hint = new Text({
        text: "Pick numbers to see payouts",
        style: { fontFamily: FONT, fontSize: 14, fill: "#7f7aa3" },
      });
      hint.position.set(PAYTABLE.x + 14, top + 4);
      this.paytableRows.addChild(hint);
      return;
    }

    rows.forEach((row, i) => {
      const y = top + i * (PAY_ROW_H + PAY_ROW_GAP);
      const bg = new Sprite(row.active ? this.payRowTex.active : this.payRowTex.normal);
      bg.position.set(PAYTABLE.x + 10, y);
      const style = row.active ? PAY_ROW_ACTIVE_TEXT : PAY_ROW_TEXT;
      const hits = new Text({ text: String(row.matches), style });
      hits.anchor.set(0, 0.5);
      hits.position.set(PAYTABLE.x + 20, y + PAY_ROW_H / 2);
      const pays = new Text({ text: row.payout.toLocaleString(), style });
      pays.anchor.set(1, 0.5);
      pays.position.set(PAYTABLE.x + PAYTABLE.w - 20, y + PAY_ROW_H / 2);
      this.paytableRows.addChild(bg, hits, pays);
    });
  }

  destroy() {
    this.alive = false;
    this.creditPulse.destroy();
    for (const t of this.ownedTextures) t.destroy(true);
  }
}

function cellCenterX(col: number) {
  return BOARD_X + col * COL_PITCH + CELL_W / 2;
}

/** Slot for the i-th drawn ball: 3 per row, filling from the port's floor upwards. */
function ballSlot(i: number) {
  const col = i % BALL_COLS;
  const row = Math.floor(i / BALL_COLS);
  const innerCx = LEFT_X + PORT_W * ((PORT_INNER.left + PORT_INNER.right) / 2);
  const floor = PORT_Y + PORT_H * PORT_INNER.bottom - 8;
  return {
    x: innerCx + (col - (BALL_COLS - 1) / 2) * BALL_PITCH,
    y: floor - BALL / 2 - row * BALL_PITCH,
  };
}
