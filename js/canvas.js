// ============================================================
// canvas.js - ドット絵キャンバスの処理
//
// ・PixelCanvas   : お絵かきエディタ（ペン / けしごむ / ぬりつぶし / もどす）
// ・drawSprite    : ドット絵データをキャンバスに描く
// ・composeHalves : ペアの左右の絵を1枚にあわせる
// ・aiGenerate    : AIで1つのキャラにする（未設定なら簡易処理）
// ・animateSprite : 2コマのゆれるアニメーション
//
// ドット絵データは「パレット番号の1次元配列」（0 = とうめい）。
// 例：16x16 なら長さ 256 の配列。
// ============================================================

export const PALETTE = [
  null,       // 0: とうめい
  "#2b2118",  // 1: こげちゃ
  "#ffffff",  // 2: しろ
  "#e63946",  // 3: あか
  "#ff9f43",  // 4: オレンジ
  "#ffd166",  // 5: きいろ
  "#8bc34a",  // 6: きみどり
  "#2a9d8f",  // 7: みどり
  "#4cc9f0",  // 8: みずいろ
  "#4361ee",  // 9: あお
  "#9b5de5",  // 10: むらさき
  "#f78fb3",  // 11: ピンク
  "#8d5524",  // 12: ちゃいろ
  "#f1c9a5",  // 13: はだいろ
  "#9aa0a6",  // 14: はいいろ
  "#fff3d6",  // 15: クリーム
];

export const emptyGrid = (cols, rows) => new Array(cols * rows).fill(0);

export const isEmptyGrid = (data) => !data || data.every((v) => v === 0);

// ------------------------------------------------------------
// 描画ヘルパー
// ------------------------------------------------------------

/** ドット絵データを ctx に描く（scale = 1ドットのピクセル数） */
export function drawSprite(ctx, data, cols, rows, scale = 1, ox = 0, oy = 0) {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const color = PALETTE[data[y * cols + x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

/** キャンバス全体をクリアして、ドット絵を1枚描く（プレビュー用） */
export function renderPreview(canvas, data, cols, rows) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!data) return;
  const scale = Math.max(1, Math.floor(Math.min(canvas.width / cols, canvas.height / rows)));
  const ox = Math.floor((canvas.width - cols * scale) / 2);
  const oy = Math.floor((canvas.height - rows * scale) / 2);
  drawSprite(ctx, data, cols, rows, scale, ox, oy);
}

// ------------------------------------------------------------
// PixelCanvas : お絵かきエディタ
// ------------------------------------------------------------
export class PixelCanvas {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{cols?:number, rows?:number, cell?:number, onChange?:Function}} opts
   */
  constructor(canvas, { cols = 16, rows = 16, cell = 20, onChange = null } = {}) {
    this.canvas = canvas;
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;
    this.onChange = onChange;

    canvas.width = cols * cell;
    canvas.height = rows * cell;
    this.ctx = canvas.getContext("2d");

    this.data = emptyGrid(cols, rows);
    this.color = 1;
    this.tool = "pen"; // "pen" | "eraser" | "fill"
    this.undoStack = [];
    this.readOnly = false;

    this._drawing = false;
    this._changed = false;
    this._bind();
    this.render();
  }

  // ----- 設定 -----
  setColor(index) { this.color = index; if (this.tool === "eraser") this.tool = "pen"; }
  setTool(tool) { this.tool = tool; }

  // ----- データの出し入れ -----
  toArray() { return this.data.slice(); }

  fromArray(arr) {
    this.data = Array.isArray(arr) && arr.length === this.cols * this.rows
      ? arr.slice()
      : emptyGrid(this.cols, this.rows);
    this.undoStack = [];
    this.render();
  }

  clear() {
    if (isEmptyGrid(this.data)) return;
    this._push();
    this.data = emptyGrid(this.cols, this.rows);
    this.render();
    this._emit();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.data = prev;
    this.render();
    this._emit();
  }

  /** PNG画像のデータURLにする（保存・共有用） */
  toDataURL(scale = 8) {
    const c = document.createElement("canvas");
    c.width = this.cols * scale;
    c.height = this.rows * scale;
    drawSprite(c.getContext("2d"), this.data, this.cols, this.rows, scale);
    return c.toDataURL("image/png");
  }

  // ----- 描画 -----
  render() {
    const { ctx, cols, rows, cell } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // とうめい部分は市松模様で表す
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#ffffff" : "#f3ead8";
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    drawSprite(ctx, this.data, cols, rows, cell);

    // うすいグリッド線
    ctx.strokeStyle = "rgba(59, 42, 30, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, rows * cell); }
    for (let y = 0; y <= rows; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(cols * cell, y * cell + 0.5); }
    ctx.stroke();
  }

  // ----- 入力（マウス・タッチ・ペン共通） -----
  _bind() {
    const c = this.canvas;

    c.addEventListener("pointerdown", (e) => {
      if (this.readOnly) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      this._drawing = true;
      this._changed = false;
      this._push();
      this._apply(e);
    });

    c.addEventListener("pointermove", (e) => {
      if (this._drawing && this.tool !== "fill") this._apply(e);
    });

    const end = () => {
      if (!this._drawing) return;
      this._drawing = false;
      if (this._changed) this._emit();
      else this.undoStack.pop(); // 何も変わらなかったら履歴に残さない
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  _cellAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.cols);
    const y = Math.floor(((e.clientY - r.top) / r.height) * this.rows);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return { x, y };
  }

  _apply(e) {
    const p = this._cellAt(e);
    if (!p) return;
    const i = p.y * this.cols + p.x;

    if (this.tool === "fill") {
      this._floodFill(p.x, p.y, this.color);
      return;
    }
    const value = this.tool === "eraser" ? 0 : this.color;
    if (this.data[i] === value) return;
    this.data[i] = value;
    this._changed = true;
    this.render();
  }

  _floodFill(sx, sy, value) {
    const { cols, rows, data } = this;
    const target = data[sy * cols + sx];
    if (target === value) return;
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      if (data[y * cols + x] !== target) continue;
      data[y * cols + x] = value;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    this._changed = true;
    this.render();
  }

  _push() {
    this.undoStack.push(this.data.slice());
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  _emit() {
    if (this.onChange) this.onChange(this.toArray());
  }
}

// ------------------------------------------------------------
// ペアの合成・AI
// ------------------------------------------------------------

/** 左(cols x rows)と右(cols x rows)を横にならべて (cols*2 x rows) にする */
export function composeHalves(left, right, cols = 16, rows = 16) {
  const L = left && left.length === cols * rows ? left : emptyGrid(cols, rows);
  const R = right && right.length === cols * rows ? right : emptyGrid(cols, rows);
  const out = emptyGrid(cols * 2, rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      out[y * cols * 2 + x] = L[y * cols + x];
      out[y * cols * 2 + cols + x] = R[y * cols + x];
    }
  }
  return out;
}

/** つなぎ目で、片方だけ絵があるすき間を、となりの色でうめる */
export function smoothSeam(data, cols, rows) {
  const out = data.slice();
  const a = cols / 2 - 1;
  const b = cols / 2;
  for (let y = 0; y < rows; y++) {
    const l = out[y * cols + a];
    const r = out[y * cols + b];
    if (l === 0 && r !== 0) out[y * cols + a] = r;
    else if (r === 0 && l !== 0) out[y * cols + b] = l;
  }
  return out;
}

/** キャラのまわりに こげちゃ色の ふちどりを つける */
export function outlineSprite(data, cols, rows) {
  const out = data.slice();
  const at = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : data[y * cols + x]);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (data[y * cols + x] !== 0) continue;
      if (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) {
        out[y * cols + x] = 1;
      }
    }
  }
  return out;
}

/**
 * AI の設定。endpoint に自分のサーバーのURLを入れると、そちらに
 *   POST { pixels, cols, rows }  →  { pixels } を返す
 * 想定で動く。APIキーはブラウザに書かず、必ずサーバー側で持つこと。
 */
export const AI_CONFIG = { endpoint: "" };

/** 左右をあわせたドット絵を、ひとつのキャラに仕上げる */
export async function aiGenerate(data, cols, rows) {
  if (AI_CONFIG.endpoint) {
    try {
      const res = await fetch(AI_CONFIG.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixels: data, cols, rows }),
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.pixels) && json.pixels.length === cols * rows) return json.pixels;
      }
    } catch (err) {
      console.warn("AIサーバーに つながらなかったので、かんたん処理を つかいます。", err);
    }
  }
  // かんたん処理：ちょっと待って（AIが考えている演出）、つなぎ目補正 → ふちどり
  await new Promise((resolve) => setTimeout(resolve, 900));
  return outlineSprite(smoothSeam(data, cols, rows), cols, rows);
}

// ------------------------------------------------------------
// アニメーション
// ------------------------------------------------------------

/**
 * 2コマ（ふつう / ぴょん）で切りかわるアニメーションを canvas に描く。
 * 止めるための関数を返す。
 */
export function animateSprite(canvas, data, cols, rows) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const scale = Math.max(1, Math.floor(Math.min(canvas.width / cols, (canvas.height - 4) / rows)));
  const ox = Math.floor((canvas.width - cols * scale) / 2);
  const baseY = canvas.height - rows * scale;

  let frame = 0;
  let timer = null;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // かげ
    ctx.fillStyle = "rgba(59, 42, 30, 0.18)";
    ctx.fillRect(ox + scale * 2, canvas.height - 3, cols * scale - scale * 4, 3);
    // 本体（フレーム1は1ドットぶん上へ）
    const lift = frame === 1 ? scale : 0;
    drawSprite(ctx, data, cols, rows, scale, ox, baseY - 3 - lift);
    frame = 1 - frame;
  };

  draw();
  if (!reduced) timer = setInterval(draw, 400);
  return () => { if (timer) clearInterval(timer); };
}
