// ============================================================
// firebase.js - データベース・ログインの処理
//
// ・FIREBASE_CONFIG を設定すると Firebase（匿名ログイン + Firestore）で動く
// ・未設定のあいだは localStorage で動く「おためしモード」
// どちらでも同じ関数（init / signIn / loadDoc / saveDoc / watchDoc）で使えます。
// ============================================================

// ▼ Firebase コンソールで表示される設定値をここに貼り付けてください
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const LS = "pixel-ibasho:";

let mode = "local"; // "firebase" | "local"
let fb = null;

const isConfigured = () => !FIREBASE_CONFIG.apiKey.startsWith("YOUR_");

/** 初期化。使うモード（"firebase" か "local"）を返す */
export async function init() {
  if (!isConfigured()) return mode;
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    const app = appMod.initializeApp(FIREBASE_CONFIG);
    fb = {
      auth: authMod.getAuth(app),
      signInAnonymously: authMod.signInAnonymously,
      db: fsMod.getFirestore(app),
      fs: fsMod,
    };
    mode = "firebase";
  } catch (err) {
    console.warn("Firebase の読み込みに失敗。おためしモードで動きます。", err);
    mode = "local";
  }
  return mode;
}

export const getMode = () => mode;

/** 匿名ログイン（本名やメールは使わない）。ユーザーIDを返す */
export async function signIn() {
  if (mode === "firebase") {
    const cred = await fb.signInAnonymously(fb.auth);
    return cred.user.uid;
  }
  let uid = localStorage.getItem(LS + "uid");
  if (!uid) {
    uid = "local-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(LS + "uid", uid);
  }
  return uid;
}

// ---------- ローカル用ヘルパー ----------
const localKey = (col, id) => `${LS}doc:${col}/${id}`;

function readLocal(col, id) {
  try {
    const raw = localStorage.getItem(localKey(col, id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

/** オブジェクトだけ再帰的にマージ（配列は上書き）。Firestore の merge と同じ挙動 */
function deepMerge(base, patch) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

// ---------- 共通API ----------

/** ドキュメントを1回だけ読む。なければ null */
export async function loadDoc(col, id) {
  if (mode === "firebase") {
    const snap = await fb.fs.getDoc(fb.fs.doc(fb.db, col, id));
    return snap.exists() ? snap.data() : null;
  }
  return readLocal(col, id);
}

/** ドキュメントに保存（既存の項目は残して、渡した項目だけ更新） */
export async function saveDoc(col, id, data) {
  if (mode === "firebase") {
    const ref = fb.fs.doc(fb.db, col, id);
    await fb.fs.setDoc(ref, { ...data, updatedAt: fb.fs.serverTimestamp() }, { merge: true });
    return;
  }
  const merged = deepMerge(readLocal(col, id), { ...data, updatedAt: Date.now() });
  const key = localKey(col, id);
  localStorage.setItem(key, JSON.stringify(merged));
  // 同じタブの中の watchDoc にも知らせる（storage イベントは別タブにしか飛ばないため）
  window.dispatchEvent(new CustomEvent("pixel-ibasho:local", { detail: key }));
}

/** ドキュメントの変化を見守る。解除する関数を返す */
export function watchDoc(col, id, callback) {
  if (mode === "firebase") {
    return fb.fs.onSnapshot(fb.fs.doc(fb.db, col, id), (snap) => {
      callback(snap.exists() ? snap.data() : null);
    });
  }
  const key = localKey(col, id);
  const emit = () => callback(readLocal(col, id));
  const onStorage = (e) => { if (e.key === key) emit(); };
  const onLocal = (e) => { if (e.detail === key) emit(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener("pixel-ibasho:local", onLocal);
  emit();
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pixel-ibasho:local", onLocal);
  };
}
