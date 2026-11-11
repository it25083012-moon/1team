// ============================================================
// main.js - 全体の制御
// 画面の切りかえ、4週間のミッション、カレーなべの表示をまとめる
// ============================================================

import * as db from "./firebase.js";
import {
  PALETTE,
  PixelCanvas,
  composeHalves,
  aiGenerate,
  animateSprite,
  renderPreview,
  isEmptyGrid,
} from "./canvas.js";

// ------------------------------------------------------------
// 設定（先生・ファシリテーターが書きかえる場所）
// ------------------------------------------------------------
const CONFIG = {
  partyDate: "日にち：先生と相談して決めよう",
  partyPlace: "ばしょ：先生と相談して決めよう",
  // ?open=all をURLにつけると、すべての週が最初から開く（先生の確認用）
  openAll: new URLSearchParams(location.search).get("open") === "all",
};

const WEEKS = [
  { id: 1, label: "Week 1", people: "1にん", title: "じぶんを あらわそう",   goal: "じぶんだけの「いばしょ」をつくる" },
  { id: 2, label: "Week 2", people: "2にん", title: "ふたりで つくろう",     goal: "「はんぶんこAIキャラクター」をつくる" },
  { id: 3, label: "Week 3", people: "4〜10にん", title: "チームで かんがえよう", goal: "とくせいカレーの レシピを つくる" },
  { id: 4, label: "Week 4", people: "20にん", title: "みんなで あおう",      goal: "カレーパーティーを ひらく" },
];

// カレーのぐざい（各週のごほうび）。8x8 のドット絵
const INGREDIENTS = [
  { name: "にんじん",   art: ["...gg...", "..g..g..", "..oooo..", "..oooo..", "...oo...", "...oo...", "....o...", "........"] },
  { name: "じゃがいも", art: ["........", "..bbbb..", ".bbyybb.", ".bybbyb.", ".bbbbbb.", ".bbybbb.", "..bbbb..", "........"] },
  { name: "たまねぎ",   art: ["...y....", "..yyy...", ".ywwwwy.", ".wwwwww.", ".wwwwww.", ".wwwwww.", "..wwww..", "........"] },
  { name: "カレールー", art: ["........", ".bbbbbb.", ".bkkkkb.", ".bkrrkb.", ".bkkkkb.", ".bbbbbb.", "........", "........"] },
];
const ART_COLORS = { o: "#ff9f43", g: "#4caf50", y: "#ffd166", b: "#8d5524", w: "#fff3d6", r: "#c0392b", k: "#2b2118" };

const PREP_ITEMS = [
  "あつまる じかんと ばしょを たしかめた",
  "もちもの（エプロン・のみもの）を じゅんびした",
  "いっしょに くる ひと（おうちの ひと・先生）に つたえた",
  "じぶんの アイコンを みんなに みせる じゅんびが できた",
];

// ------------------------------------------------------------
// 状態
// ------------------------------------------------------------
const state = {
  uid: null,
  profile: {
    nickname: "",
    icon: null,
    sticker: null,
    feeling: "",
    progress: { 1: false, 2: false, 3: false, 4: false },
    prep: [false, false, false, false],
  },
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2800);
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const normalizeCode = (s) => s.trim().toLowerCase().replace(/\s+/g, "");

async function saveProfile() {
  await db.saveDoc("users", state.uid, state.profile);
}

const doneCount = () => Object.values(state.profile.progress).filter(Boolean).length;

async function completeWeek(id) {
  const first = !state.profile.progress[id];
  state.profile.progress[id] = true;
  await saveProfile();
  if (first) toast(`🎉 ${INGREDIENTS[id - 1].name} を ゲット！`);
  renderHome();
  showScreen("home");
}

// ------------------------------------------------------------
// 画面の切りかえ
// ------------------------------------------------------------
let currentScreen = "login";
const inited = {};
const cleanups = {}; // 画面を出るときに止めたいもの（アニメ・見守り）

function showScreen(name) {
  // 今の画面の後かたづけ
  if (cleanups[currentScreen]) cleanups[currentScreen]();

  $$(".screen").forEach((s) => (s.hidden = s.id !== `screen-${name}`));
  currentScreen = name;
  $("#topbar").hidden = name === "login";
  window.scrollTo({ top: 0 });

  if (name === "home") renderHome();
  if (name === "week1") enterWeek1();
  if (name === "week2") enterWeek2();
  if (name === "week3") enterWeek3();
  if (name === "week4") enterWeek4();
}

// ------------------------------------------------------------
// パレット・ツールの部品
// ------------------------------------------------------------
function mountTools(key, pc) {
  const palette = $(`.palette[data-for="${key}"]`);
  const tools = $(`.tools[data-for="${key}"]`);
  palette.innerHTML = "";
  tools.innerHTML = "";

  PALETTE.forEach((color, i) => {
    if (!color) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (i === pc.color ? " active" : "");
    b.style.background = color;
    b.setAttribute("aria-label", `いろ ${i}`);
    b.onclick = () => {
      pc.setColor(i);
      $$(".swatch", palette).forEach((s) => s.classList.toggle("active", s === b));
      syncTools();
    };
    palette.appendChild(b);
  });

  const defs = [
    ["pen", "✏️ ペン"],
    ["eraser", "🧽 けしごむ"],
    ["fill", "🪣 ぬる"],
  ];
  const toolButtons = defs.map(([tool, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small";
    b.textContent = label;
    b.onclick = () => { pc.setTool(tool); syncTools(); };
    tools.appendChild(b);
    return [tool, b];
  });
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "btn small";
  undo.textContent = "↩️ もどす";
  undo.onclick = () => pc.undo();
  tools.appendChild(undo);

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn small";
  clear.textContent = "🗑️ ぜんぶ けす";
  clear.onclick = () => { if (confirm("ぜんぶ けして いい？")) pc.clear(); };
  tools.appendChild(clear);

  function syncTools() {
    toolButtons.forEach(([tool, b]) => b.classList.toggle("active", pc.tool === tool));
  }
  syncTools();
}

// ------------------------------------------------------------
// ログイン
// ------------------------------------------------------------
async function start() {
  const nickname = $("#login-nickname").value.trim();
  if (!nickname) {
    toast("ニックネームを いれてね");
    return;
  }
  $("#btn-start").disabled = true;
  try {
    state.uid = await db.signIn();
    const saved = await db.loadDoc("users", state.uid);
    if (saved) {
      state.profile = {
        ...state.profile,
        ...saved,
        progress: { ...state.profile.progress, ...(saved.progress || {}) },
        prep: saved.prep || state.profile.prep,
      };
    }
    state.profile.nickname = nickname;
    await saveProfile();
    afterLogin();
  } catch (err) {
    console.error(err);
    toast("うまく つながらなかったよ。もういちど ためしてね");
  } finally {
    $("#btn-start").disabled = false;
  }
}

function afterLogin() {
  $("#hello").textContent = `${state.profile.nickname} さん`;
  $("#mode-badge").textContent = db.getMode() === "local" ? "おためしモード" : "";
  showScreen("home");
}

// ------------------------------------------------------------
// ホーム（カレーなべ + 週のカード）
// ------------------------------------------------------------
function renderHome() {
  const list = $("#week-list");
  list.innerHTML = "";

  WEEKS.forEach((w) => {
    const done = !!state.profile.progress[w.id];
    const unlocked = w.id === 1 || state.profile.progress[w.id - 1] || CONFIG.openAll;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "week-card" + (done ? " done" : "") + (unlocked ? "" : " locked");
    card.disabled = !unlocked;
    card.innerHTML = `
      <div class="week-num">${w.id}</div>
      <div>
        <div class="week-title"></div>
        <div class="week-meta"></div>
      </div>
      <div class="week-status"></div>`;
    $(".week-title", card).textContent = `${w.label}　${w.title}`;
    $(".week-meta", card).textContent = `${w.people} ／ ${w.goal}`;
    $(".week-status", card).textContent = done ? "✅" : unlocked ? "▶" : "🔒";
    card.onclick = () => showScreen(`week${w.id}`);
    list.appendChild(card);
  });

  const n = doneCount();
  $("#pot-message").textContent =
    n === 0 ? "まずは Week 1 から。ぐざいを あつめよう！"
    : n < 4 ? `ぐざいが ${n}こ あつまったよ。のこり ${4 - n}こ！`
    : "ぐざいが ぜんぶ そろった！ カレーの じゅんび かんぺき🍛";
  drawPot(n);
}

let steamTimer = null;
function drawPot(count) {
  const canvas = $("#pot");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  clearInterval(steamTimer);

  const paint = (steamFrame) => {
    ctx.clearRect(0, 0, 128, 96);

    // ぐざい（なべの上にならぶ）
    INGREDIENTS.forEach((ing, i) => {
      if (i >= count) {
        // まだの ぐざいは、うすい かげ
        ctx.fillStyle = "rgba(59, 42, 30, 0.12)";
        ctx.fillRect(14 + i * 26, 26, 16, 16);
        return;
      }
      ing.art.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch === ".") return;
          ctx.fillStyle = ART_COLORS[ch];
          ctx.fillRect(14 + i * 26 + x * 2, 26 + y * 2, 2, 2);
        });
      });
    });

    // なべ本体
    ctx.fillStyle = "#555a63"; ctx.fillRect(20, 52, 88, 36);   // 胴
    ctx.fillStyle = "#7b818c"; ctx.fillRect(16, 48, 96, 6);    // ふち
    ctx.fillStyle = "#3b2a1e"; ctx.fillRect(10, 56, 8, 5); ctx.fillRect(110, 56, 8, 5); // 取っ手
    ctx.fillStyle = "#3b2a1e"; ctx.fillRect(28, 88, 8, 4); ctx.fillRect(92, 88, 8, 4);  // あし

    // カレー（ぐざいが増えるほど たっぷり）
    if (count > 0) {
      const h = 4 + count * 3;
      ctx.fillStyle = "#c77d1a";
      ctx.fillRect(22, 54, 84, h);
      ctx.fillStyle = "#e09a2b";
      ctx.fillRect(26, 54, 20, 2);
    }

    // 湯気
    if (count > 0) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      const dy = steamFrame ? 2 : 0;
      [[44, 14], [64, 8], [84, 14]].forEach(([x, y]) => {
        ctx.fillRect(x, y + dy, 3, 3);
        ctx.fillRect(x + 3, y + 4 + dy, 3, 3);
      });
    }
  };

  let f = 0;
  paint(f);
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced && count > 0) {
    steamTimer = setInterval(() => { f = 1 - f; paint(f); }, 600);
  }
}

// ------------------------------------------------------------
// Week 1：自分を表現する
// ------------------------------------------------------------
let w1 = { pc: null, tab: "icon" };

function enterWeek1() {
  if (!inited.w1) {
    inited.w1 = true;
    w1.pc = new PixelCanvas($("#w1-canvas"), {
      cols: 16, rows: 16, cell: 20,
      onChange: (data) => renderPreview($("#w1-preview"), data, 16, 16),
    });
    mountTools("w1", w1.pc);

    $$(".tab").forEach((tab) => {
      tab.onclick = () => switchW1Tab(tab.dataset.tab);
    });
    $$("#w1-feeling-row .chip").forEach((chip) => {
      chip.onclick = () => {
        state.profile.feeling = chip.dataset.feeling;
        syncFeeling();
      };
    });
    $("#w1-save").onclick = saveWeek1;
  }
  w1.tab = "icon";
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "icon"));
  $("#w1-feeling-row").hidden = true;
  w1.pc.fromArray(state.profile.icon);
  renderPreview($("#w1-preview"), w1.pc.toArray(), 16, 16);
  syncFeeling();
}

function stashW1() {
  // 今 開いているタブの絵を、プロフィールにしまう
  const key = w1.tab === "icon" ? "icon" : "sticker";
  state.profile[key] = w1.pc.toArray();
}

function switchW1Tab(tab) {
  if (tab === w1.tab) return;
  stashW1();
  w1.tab = tab;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("#w1-feeling-row").hidden = tab !== "sticker";
  w1.pc.fromArray(tab === "icon" ? state.profile.icon : state.profile.sticker);
  renderPreview($("#w1-preview"), w1.pc.toArray(), 16, 16);
}

function syncFeeling() {
  $$("#w1-feeling-row .chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.feeling === state.profile.feeling)
  );
}

async function saveWeek1() {
  stashW1();
  if (isEmptyGrid(state.profile.icon)) {
    toast("まず マイアイコンを かいてみよう（ちょっとだけでも OK）");
    return;
  }
  await saveProfile();
  await completeWeek(1);
}

// ------------------------------------------------------------
// Week 2：ペアでつくる
// ------------------------------------------------------------
const w2 = { pc: null, code: null, side: "left", doc: {}, unsub: null, stopAnim: null, result: null, loadedMine: false };

function enterWeek2() {
  if (!inited.w2) {
    inited.w2 = true;
    w2.pc = new PixelCanvas($("#w2-canvas"), {
      cols: 16, rows: 16, cell: 20,
      onChange: () => updatePair(),
    });
    mountTools("w2", w2.pc);

    $("#w2-join").onclick = joinPair;
    $("#w2-save").onclick = saveMyHalf;
    $("#w2-generate").onclick = generateCharacter;
    $("#w2-complete").onclick = () => completeWeek(2);
  }
  updatePair();
}
cleanups.week2 = () => {
  if (w2.stopAnim) { w2.stopAnim(); w2.stopAnim = null; }
};

function joinPair() {
  const code = normalizeCode($("#w2-code").value);
  if (code.length < 2) {
    toast("あいことばを 2もじ いじょう いれてね");
    return;
  }
  if (w2.unsub) w2.unsub();
  w2.code = code;
  w2.side = $("#w2-side").value;
  w2.loadedMine = false;
  $("#w2-status").textContent = `「${code}」に つながったよ。${w2.side === "left" ? "ひだり" : "みぎ"}がわを かこう！`;

  w2.unsub = db.watchDoc("pairs", code, (doc) => {
    w2.doc = doc || {};
    // 前に かいた じぶんの はんぶんが あれば、つづきから
    if (!w2.loadedMine && w2.doc[w2.side]) {
      w2.pc.fromArray(w2.doc[w2.side]);
    }
    w2.loadedMine = true;
    updatePair();
  });
}

function currentPairGrids() {
  const mine = w2.pc.toArray();
  const left = w2.side === "left" ? mine : w2.doc.left;
  const right = w2.side === "right" ? mine : w2.doc.right;
  return { left, right };
}

function updatePair() {
  const { left, right } = currentPairGrids();
  const composed = composeHalves(left, right);
  renderPreview($("#w2-preview"), composed, 32, 16);

  const both = !isEmptyGrid(left) && !isEmptyGrid(right);
  $("#w2-generate").disabled = !both;

  if (w2.code) {
    const partner = w2.side === "left" ? w2.doc.right : w2.doc.left;
    $("#w2-status").textContent = isEmptyGrid(partner)
      ? `「${w2.code}」に つながってるよ。ペアは まだ かいてないみたい。ゆっくり まとう。`
      : `「${w2.code}」ペアが かいてくれたよ！ ふたりの キャラが みえるね。`;
  }
}

async function saveMyHalf() {
  if (!w2.code) {
    toast("さきに ペアの あいことばで「つながる」を おしてね");
    return;
  }
  if (isEmptyGrid(w2.pc.toArray())) {
    toast("ちょっとだけでも かいてから ほぞんしてね");
    return;
  }
  await db.saveDoc("pairs", w2.code, { [w2.side]: w2.pc.toArray() });
  toast("ほぞんしたよ！ ペアにも みえるよ");
}

async function generateCharacter() {
  const { left, right } = currentPairGrids();
  const composed = composeHalves(left, right);
  $("#w2-generate").disabled = true;
  $("#w2-generate").textContent = "AIが かんがえちゅう…";
  try {
    const result = await aiGenerate(composed, 32, 16);
    if (w2.stopAnim) w2.stopAnim();
    w2.result = result;
    $("#w2-result").hidden = false;
    w2.stopAnim = animateSprite($("#w2-anim"), result, 32, 16);
    toast("キャラクターが うごきだしたよ！");
  } finally {
    $("#w2-generate").textContent = "✨ AIで うごかす";
    $("#w2-generate").disabled = false;
  }
}

// ------------------------------------------------------------
// Week 3：チームで企画する
// ------------------------------------------------------------
const w3 = { code: null, doc: {}, unsub: null };

function enterWeek3() {
  if (!inited.w3) {
    inited.w3 = true;
    $("#w3-join").onclick = joinTeam;
    $("#w3-add").onclick = addIngredient;
    $("#w3-ingredient").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) addIngredient();
    });
    $("#w3-save-story").onclick = saveStory;
    $("#w3-complete").onclick = completeRecipe;
  }
  renderTeam();
}

function joinTeam() {
  const code = normalizeCode($("#w3-code").value);
  if (code.length < 2) {
    toast("あいことばを 2もじ いじょう いれてね");
    return;
  }
  if (w3.unsub) w3.unsub();
  w3.code = code;
  $("#w3-status").textContent = `「${code}」チームに つながったよ。`;
  w3.unsub = db.watchDoc("teams", code, (doc) => {
    w3.doc = doc || {};
    renderTeam();
  });
}

function requireTeam() {
  if (!w3.code) {
    toast("さきに チームの あいことばで「つながる」を おしてね");
    return false;
  }
  return true;
}

async function addIngredient() {
  if (!requireTeam()) return;
  const input = $("#w3-ingredient");
  const name = input.value.trim();
  if (!name) return;
  if (Object.keys(w3.doc.ingredients || {}).length >= 30) {
    toast("ぐざいが いっぱいだよ！");
    return;
  }
  // ぐざいは「ID → 中身」のマップで持つ（みんなが同時に足しても消えない）
  await db.saveDoc("teams", w3.code, {
    ingredients: { [newId()]: { name, by: state.profile.nickname, at: Date.now() } },
  });
  input.value = "";
  input.focus();
}

async function saveStory() {
  if (!requireTeam()) return;
  const text = $("#w3-story").value.trim();
  if (!text) {
    toast("ものがたりを ひとこと かいてね");
    return;
  }
  await db.saveDoc("teams", w3.code, {
    stories: { [state.uid]: { text, by: state.profile.nickname, at: Date.now() } },
  });
  toast("ものがたりを のせたよ！");
}

function renderTeam() {
  // ぐざい
  const ul = $("#w3-ingredients");
  ul.innerHTML = "";
  const items = Object.values(w3.doc.ingredients || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
  items.forEach((it) => {
    const li = document.createElement("li");
    li.textContent = it.name;
    const by = document.createElement("span");
    by.className = "by";
    by.textContent = it.by || "";
    li.appendChild(by);
    ul.appendChild(li);
  });

  // ものがたり
  const sl = $("#w3-stories");
  sl.innerHTML = "";
  const stories = Object.values(w3.doc.stories || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
  stories.forEach((s) => {
    const li = document.createElement("li");
    const by = document.createElement("span");
    by.className = "by";
    by.textContent = `${s.by || "だれか"} より`;
    li.appendChild(by);
    li.appendChild(document.createTextNode(s.text));
    sl.appendChild(li);
  });
}

async function completeRecipe() {
  if (!requireTeam()) return;
  const n = Object.keys(w3.doc.ingredients || {}).length;
  const s = Object.keys(w3.doc.stories || {}).length;
  if (n < 3) {
    toast("ぐざいを あと " + (3 - n) + "こ ふやそう");
    return;
  }
  if (s < 1) {
    toast("ものがたりを ひとつ のせよう");
    return;
  }
  await completeWeek(3);
}

// ------------------------------------------------------------
// Week 4：みんなで会う
// ------------------------------------------------------------
function enterWeek4() {
  $("#w4-date").textContent = CONFIG.partyDate;
  $("#w4-place").textContent = CONFIG.partyPlace;

  // じゅんびチェック
  const ul = $("#w4-checklist");
  ul.innerHTML = "";
  PREP_ITEMS.forEach((text, i) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!state.profile.prep[i];
    box.onchange = async () => {
      state.profile.prep[i] = box.checked;
      await saveProfile();
    };
    label.appendChild(box);
    label.appendChild(document.createTextNode(text));
    li.appendChild(label);
    ul.appendChild(li);
  });

  // じこしょうかいカード
  $("#w4-name").textContent = state.profile.nickname;
  $("#w4-feeling").textContent = state.profile.feeling ? `いまの きもち：${state.profile.feeling}` : "";
  const iconCanvas = $("#w4-icon");
  renderPreview(iconCanvas, state.profile.icon, 16, 16);

  if (!inited.w4) {
    inited.w4 = true;
    $("#w4-join").onclick = async () => {
      if (!state.profile.prep.every(Boolean)) {
        toast("じゅんびチェックを ぜんぶ つけてから おしてね");
        return;
      }
      await completeWeek(4);
      toast("🍛 カレーパーティーで あおうね！");
    };
    $("#w4-skip").onclick = () => {
      toast("だいじょうぶ。また あたらしい日に あおうね");
      showScreen("home");
    };
  }
}

// ------------------------------------------------------------
// 起動
// ------------------------------------------------------------
async function boot() {
  await db.init();

  $("#btn-start").onclick = start;
  $("#login-nickname").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) start();
  });
  $("#btn-home").onclick = () => showScreen("home");

  // 前に使った ニックネームを、入力らんに もどす
  try {
    const uid = await db.signIn();
    const saved = await db.loadDoc("users", uid);
    if (saved && saved.nickname) $("#login-nickname").value = saved.nickname;
  } catch {
    /* ログイン前の下調べなので、失敗しても気にしない */
  }
}

boot();
