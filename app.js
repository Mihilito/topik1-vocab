// ===== 学習記録 =====
const STORE_KEY = "topik1_stats_v1";

function loadStats() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {}; // プライベートモードなどで読めない場合は記録なしとして動かす
  }
}
function saveStats() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(stats));
  } catch (e) { /* 保存できなくても出題は続けられる */ }
}
// stats[id] = { c: 正解数, w: 不正解数, last: "o" | "x", t: 最後に出題した時刻 }
let stats = loadStats();

// 同じ瞬間に答えても順番が入れ替わらないよう、必ず前より大きい値を返す
let lastT = Math.max(0, ...Object.values(stats).map(s => s.t || 0));
function nextT() {
  lastT = Math.max(Date.now(), lastT + 1);
  return lastT;
}

const weakIds   = () => WORDS.filter(w => stats[w.id]?.last === "x").map(w => w.id);
const isMastered = w => stats[w.id]?.last === "o" && stats[w.id].c >= 2;

function record(id, ok) {
  const s = stats[id] || { c: 0, w: 0, last: null };
  if (ok) s.c++; else s.w++;
  s.last = ok ? "o" : "x";
  s.t = nextT();      // 次の出題順を決めるために、最後に出した時点を残す
  stats[id] = s;
  saveStats();
}

// 出題する単語を選ぶ。
// まだ出していない単語を先に、そのあとは「最後に出したのが古い順」。
// これで、全部を一巡するまで同じ単語は二度出てこない。
function pickForQuiz(ids, n) {
  const unseen = ids.filter(id => !stats[id]);
  const seen = ids
    .filter(id => stats[id])
    .sort((a, b) => (stats[a].t || 0) - (stats[b].t || 0));
  const ordered = shuffle(unseen).concat(seen);
  return shuffle(n > 0 ? ordered.slice(0, n) : ordered);
}

// ===== 画面切り替え =====
const screens = {
  home:   document.getElementById("screen-home"),
  quiz:   document.getElementById("screen-quiz"),
  result: document.getElementById("screen-result"),
  list:   document.getElementById("screen-list"),
};
function show(name) {
  Object.entries(screens).forEach(([k, el]) => (el.hidden = k !== name));
  window.scrollTo(0, 0);
}

// ===== ホーム =====
let dir = "ko2ja";   // ko2ja / ja2ko / mix
let qCount = 10;     // 0 = 全部
let weakMix = 0.3;   // 通常の出題のうち、苦手な単語から出す割合（0 = 混ぜない）
const DIR_LABEL = { ko2ja: "韓国語 → 日本語", ja2ko: "日本語 → 韓国語" };

function renderHome() {
  const learned = WORDS.filter(w => stats[w.id]).length;
  const unseen = WORDS.length - learned;
  const weak = weakIds().length;
  document.getElementById("stat-unseen").textContent   = unseen;
  document.getElementById("stat-learned").textContent  = learned;
  document.getElementById("stat-mastered").textContent = WORDS.filter(isMastered).length;
  document.getElementById("stat-weak").textContent     = weak;

  const base = unseen > 0
    ? `まだ出していない ${unseen} 語から先に出します。`
    : `全${WORDS.length}語を一巡しました。ここからは出題が古い順に出します。`;
  let mixNote = "";
  if (qCount === 0) {
    mixNote = "「全部」では全語を出すので、苦手な単語もすべて含まれます。";
  } else if (weakMix > 0 && weak > 0) {
    const k = Math.min(weak, Math.round(qCount * weakMix));
    mixNote = `${qCount}問のうち ${k}問 は苦手な単語から出します。`;
  } else if (weakMix > 0) {
    mixNote = "いまは苦手な単語がないので、混ぜずに出題します。";
  }
  document.getElementById("start-hint").textContent = mixNote ? `${base} ${mixNote}` : base;

  document.getElementById("review-badge").textContent = weak;
  const reviewBtn = document.getElementById("btn-review");
  reviewBtn.disabled = weak === 0;
  document.getElementById("review-hint").textContent =
    weak === 0
      ? "間違えた単語がここに溜まります。正解すると苦手リストから外れます。"
      : `苦手な単語が ${weak} 語あります。`;
}

function bindChips(containerId, attr, onPick) {
  const box = document.getElementById(containerId);
  box.addEventListener("click", e => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    box.querySelectorAll(".chip").forEach(c => c.classList.remove("is-on"));
    btn.classList.add("is-on");
    onPick(btn.dataset[attr]);
  });
}
bindChips("dir-chips", "dir", v => (dir = v));
bindChips("count-chips", "count", v => { qCount = Number(v); renderHome(); });
bindChips("mix-chips", "mix", v => { weakMix = Number(v); renderHome(); });

document.getElementById("btn-start").onclick  = () => startQuiz(null, false);
document.getElementById("btn-review").onclick = () => startQuiz(weakIds(), true);
document.getElementById("btn-list").onclick   = () => { renderList(); show("list"); };
document.getElementById("btn-reset").onclick  = () => {
  if (!confirm("学習記録（正解数・苦手リスト）をすべて消します。よろしいですか？")) return;
  stats = {};
  saveStats();
  renderHome();
};

// ===== 出題ロジック =====
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const byId = id => WORDS.find(w => w.id === id);

let quiz = null; // { items, index, score, wrong[], isReview }

function buildQuestion(word) {
  const d = dir === "mix" ? (Math.random() < 0.5 ? "ko2ja" : "ja2ko") : dir;
  const key = d === "ko2ja" ? "ja" : "ko";          // 選択肢に出す側
  const promptKey = d === "ko2ja" ? "ko" : "ja";

  // 誤答は同じ品詞から優先的に選び、足りなければ全体から補う
  const samePos = WORDS.filter(w => w.id !== word.id && w.pos === word.pos);
  const others  = WORDS.filter(w => w.id !== word.id && w.pos !== word.pos);
  const pool = shuffle(samePos).concat(shuffle(others));
  const distractors = [];
  for (const w of pool) {
    if (distractors.length === 3) break;
    if (w[key] === word[key]) continue;                    // 同じ表記は除く
    if (distractors.some(x => x[key] === w[key])) continue;
    distractors.push(w);
  }
  return {
    word,
    d,
    promptText: word[promptKey],
    choices: shuffle([word, ...distractors]),
    key,
  };
}

// 通常の出題用。設定した割合だけ苦手な単語を混ぜ、残りを未出題・古い順から埋める。
function pickWithWeak(n) {
  const all = WORDS.map(w => w.id);
  const weak = weakIds();
  if (n <= 0 || weakMix === 0 || weak.length === 0) return pickForQuiz(all, n);

  const fromWeak = pickForQuiz(weak, Math.min(weak.length, Math.round(n * weakMix)));
  const rest = pickForQuiz(all.filter(id => !fromWeak.includes(id)), n - fromWeak.length);
  return shuffle(fromWeak.concat(rest));
}

function startQuiz(ids, isReview) {
  const pool = isReview ? pickForQuiz(ids, qCount) : pickWithWeak(qCount);
  if (pool.length === 0) return;
  quiz = {
    items: pool.map(id => buildQuestion(byId(id))),
    index: 0,
    score: 0,
    wrong: [],
    isReview,
  };
  show("quiz");
  renderQuestion();
}

function renderQuestion() {
  const q = quiz.items[quiz.index];
  document.getElementById("counter").textContent = `${quiz.index + 1} / ${quiz.items.length}`;
  document.getElementById("progress-bar").style.width =
    `${(quiz.index / quiz.items.length) * 100}%`;
  document.getElementById("q-direction").textContent = DIR_LABEL[q.d];
  document.getElementById("q-word").textContent = q.promptText;
  document.getElementById("q-pos").textContent = POS_LABEL[q.word.pos];

  const box = document.getElementById("choices");
  box.innerHTML = "";
  q.choices.forEach(c => {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.textContent = c[q.key];
    btn.onclick = () => answer(btn, c);
    box.appendChild(btn);
  });
  document.getElementById("feedback").hidden = true;
}

function answer(btn, chosen) {
  const q = quiz.items[quiz.index];
  const ok = chosen.id === q.word.id;

  document.querySelectorAll(".choice").forEach(b => {
    b.disabled = true;
    if (b.textContent === q.word[q.key]) b.classList.add("is-correct");
  });
  if (!ok) btn.classList.add("is-wrong");

  record(q.word.id, ok);
  if (ok) quiz.score++;
  else quiz.wrong.push(q.word.id);

  const judge = document.getElementById("fb-judge");
  judge.textContent = ok ? "正解！" : "不正解";
  judge.className = "fb-judge " + (ok ? "ok" : "ng");
  document.getElementById("fb-ko").textContent = q.word.ko;
  document.getElementById("fb-ja").textContent = q.word.ja;
  document.getElementById("example-ko").textContent = q.word.ex_ko;
  document.getElementById("example-ja").textContent = q.word.ex_ja;

  const fb = document.getElementById("feedback");
  fb.hidden = false;
  document.getElementById("progress-bar").style.width =
    `${((quiz.index + 1) / quiz.items.length) * 100}%`;
  document.getElementById("btn-next").textContent =
    quiz.index === quiz.items.length - 1 ? "結果を見る" : "次へ";
  fb.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.getElementById("btn-next").onclick = () => {
  quiz.index++;
  if (quiz.index >= quiz.items.length) renderResult();
  else renderQuestion();
};
document.getElementById("btn-quit").onclick = () => {
  if (!confirm("この回を途中でやめますか？（ここまでの正誤は記録されています）")) return;
  renderHome();
  show("home");
};

// ===== 結果 =====
function renderResult() {
  document.getElementById("result-score").textContent = quiz.score;
  document.getElementById("result-total").textContent = quiz.items.length;
  const rate = quiz.score / quiz.items.length;
  document.getElementById("result-sub").textContent =
    rate === 1 ? "全問正解！" : rate >= 0.7 ? "いい調子です" : "復習でしっかり固めましょう";

  const list = document.getElementById("wrong-list");
  list.innerHTML = "";
  const uniq = [...new Set(quiz.wrong)];
  document.getElementById("wrong-title").textContent =
    uniq.length ? `間違えた単語（${uniq.length}語）` : "間違えた単語";

  if (uniq.length === 0) {
    list.innerHTML = '<p class="empty">この回の間違いはありません。</p>';
  } else {
    uniq.forEach(id => {
      const w = byId(id);
      const div = document.createElement("div");
      div.className = "wrong-item";
      div.innerHTML = `
        <div class="wrong-head">
          <span class="wrong-ko"></span><span class="wrong-ja"></span>
        </div>
        <p class="wrong-ex"><b></b><span></span></p>`;
      div.querySelector(".wrong-ko").textContent = w.ko;
      div.querySelector(".wrong-ja").textContent = w.ja;
      div.querySelector(".wrong-ex b").textContent = w.ex_ko;
      div.querySelector(".wrong-ex span").textContent = w.ex_ja;
      list.appendChild(div);
    });
  }
  document.getElementById("btn-retry-wrong").disabled = uniq.length === 0;
  show("result");
}
document.getElementById("btn-retry-wrong").onclick = () => {
  const ids = [...new Set(quiz.wrong)];
  if (ids.length) startQuiz(ids, true);
};
document.getElementById("btn-home").onclick = () => { renderHome(); show("home"); };

// ===== 単語一覧 =====
function renderList(keyword = "") {
  const box = document.getElementById("word-list");
  box.innerHTML = "";
  const k = keyword.trim().toLowerCase();
  const hits = WORDS.filter(w =>
    !k || w.ko.includes(k) || w.ja.toLowerCase().includes(k) || w.ex_ko.includes(k) || w.ex_ja.includes(k)
  );
  if (hits.length === 0) {
    box.innerHTML = '<p class="empty">該当する単語がありません。</p>';
    return;
  }
  hits.forEach(w => {
    const s = stats[w.id];
    const div = document.createElement("div");
    div.className = "wl-item";
    div.innerHTML = `
      <div class="wl-head">
        <span class="wl-ko"></span><span class="wl-ja"></span><span class="wl-tag"></span>
      </div>
      <p class="wl-ex"><b></b><span></span></p>`;
    div.querySelector(".wl-ko").textContent = w.ko;
    div.querySelector(".wl-ja").textContent = `${w.ja}（${POS_LABEL[w.pos]}）`;
    const tag = div.querySelector(".wl-tag");
    if (!s) {
      tag.remove();
    } else if (s.last === "x") {
      tag.textContent = "苦手";
      tag.classList.add("ng");
    } else {
      tag.textContent = `${s.c}回正解`;
    }
    div.querySelector(".wl-ex b").textContent = w.ex_ko;
    div.querySelector(".wl-ex span").textContent = w.ex_ja;
    box.appendChild(div);
  });
}
document.getElementById("list-search").addEventListener("input", e => renderList(e.target.value));
document.getElementById("btn-list-back").onclick = () => { renderHome(); show("home"); };

// ===== 起動 =====
renderHome();
show("home");
