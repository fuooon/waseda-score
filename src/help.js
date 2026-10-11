// ============================================
// Help page: かんたんガイド + 記号ガイド
// ============================================
//
// The symbol guide is generated from RESULT_TYPES / RUNNER_EVENTS and drawn
// with the same renderer as the scoresheet (renderLegendSample), and every
// example sentence comes from describe.js, so the guide cannot disagree with
// what the sheet shows.

import './styles/help.css';
import { RESULT_TYPES, RUNNER_EVENTS, POSITIONS, POSITION_FIELD_NAMES } from './rules.js';
import { renderLegendSample, SAMPLE_POSITIONS } from './cell-render.js';
import { describeResult, describeCell } from './describe.js';
import { escapeHtml } from './util.js';

// ============================================
// Texts
// ============================================

const CATEGORY_TITLES = {
  out: 'アウト',
  hit: 'ヒット（安打）',
  walk: '四球・死球',
  sacrifice: '犠打・犠飛',
  other: 'そのほかの出塁',
  runner: 'タイブレーク',
};

const CATEGORY_NOTES = {
  out: 'ボールを捕った選手 → 送球を受けた選手の順に守備番号を書きます。最初の数字の下の弧はゴロ、上の弧はフライ、上の横線はライナーの印です（守備番号が入っていない古い記録は「ゴ」「飛」「直」と表示されます）。',
  hit: 'ヒットは赤で書きます。線の本数がヒットの種類（1本＝単打、2本＝二塁打、3本＝三塁打）、数字は打球が飛んだ方向の守備番号です。',
  walk: '打数には数えません。満塁で押し出しになったときだけ打点が付きます。',
  sacrifice: '打者はアウトですが、走者を進めたので打数には数えません。',
  other: '',
  runner: '',
};

const RESULT_NOTES = {
  GROUNDOUT: '打球が地面を転がってアウトになりました。例の「6-3」は、ショートが捕って一塁へ送球したという意味です。',
  FLYOUT: '打ち上げた打球をノーバウンドで捕られてアウトになりました。',
  LINEOUT: '鋭い当たり（ライナー）をノーバウンドで捕られてアウトになりました。',
  STRIKEOUT_SWING: 'バットを振って3つ目のストライクになった三振です。',
  STRIKEOUT_LOOK: 'バットを振らずに3つ目のストライクを見送った三振です。K を左右反対にして書きます。',
  DOUBLE_PLAY: '1つのゴロで打者と走者の2人がアウトになりました。打者のマスに DP を書き、一緒にアウトになった走者のマスには T.O（走塁死）を付けます。打点は付きません。',
  INFIELD_FLY: '0・1アウトで走者が一・二塁か満塁のとき、内野フライに審判が宣告します。打者はアウトです。',
  SINGLE: '一塁まで進んだヒットです。',
  DOUBLE: '二塁まで進んだヒットです。',
  TRIPLE: '三塁まで進んだヒットです。',
  HOMERUN: '打者もホームに還るので ● が付きます。打点は「還った走者の数＋1」です。',
  WALK: 'ボールが4つで一塁へ進みました（フォアボール）。',
  INTENTIONAL_WALK: 'わざと四球にして一塁へ歩かせました（申告敬遠を含む）。',
  HIT_BY_PITCH: '投球が体に当たって一塁へ進みました（デッドボール）。',
  SACRIFICE_BUNT: 'バントで走者を進めて、打者はアウトになりました（送りバント）。守備番号を□で囲みます。',
  SACRIFICE_FLY: '外野フライの間に三塁走者がホームに還りました。守備番号を◇で囲みます。打点が1付きます。',
  ERROR: '守備のミスで打者が出塁しました。E のあとにミスをした選手の守備番号を書きます（E6＝ショートのエラー）。',
  FIELDERS_CHOICE: '守備側が打者ではなく前の走者をアウトにしようとして、打者が出塁しました。',
  STRIKEOUT_WILD: '三振ですが、捕手がボールを捕れずに打者が一塁へ走って生きました。K と一塁までの線を書き、アウトにはなりません。',
  INTERFERENCE: '捕手のミットがバットに当たるなどの妨害で、打者が一塁へ進みました。',
  TIEBREAK_RUNNER: 'タイブレークの回の初めに、ルールで塁に置かれる走者です。打席には数えません。走っていない塁までの線は点線で書きます。',
};

const RUNNER_NOTES = {
  STOLEN_BASE: '盗塁で次の塁へ進みました。',
  WILD_PITCH: '投手の暴投の間に進みました。',
  PASSED_BALL: '捕手が投球を捕れなかった（捕逸）間に進みました。',
  BALK: '投手のボークで進みました。',
  ADVANCE_ON_ERROR: '守備のエラーの間に進みました。守備側のエラーに数えます。',
  CAUGHT_STEALING: '盗塁しようとしてアウトになりました。',
  PICKOFF: '牽制球でアウトになりました。',
  RUNNER_OUT: '走っている途中でアウトになりました（封殺・タッチアウト・飛び出しなど）。併殺で一緒にアウトになった走者もこれです。',
};

// Sample situation for each runner event (base = where it happened). Each
// sample starts from the base the batting result reached, so the example
// sentence never skips a base, and together they show every base area.
const RUNNER_SAMPLES = {
  STOLEN_BASE: { base: 2, basesReached: 2 },
  WILD_PITCH: { resultType: 'TRIPLE', positions: '9', base: 4, basesReached: 4 },
  PASSED_BALL: { before: [{ type: 'STOLEN_BASE', base: 2 }], base: 3, basesReached: 3 },
  BALK: { base: 2, basesReached: 2 },
  ADVANCE_ON_ERROR: { resultType: 'DOUBLE', positions: '8', base: 3, basesReached: 3 },
  CAUGHT_STEALING: { base: 2, basesReached: 1, outNumber: 1 },
  PICKOFF: { base: 1, basesReached: 1, outNumber: 2 },
  RUNNER_OUT: { base: 3, basesReached: 2, outNumber: 1 },
};

// Symbols shown next to the label (only for results drawn with a symbol)
const HIT_LINES = { SINGLE: 1, DOUBLE: 2, TRIPLE: 3 };

function symbolChip(rt) {
  // hit marks drawn exactly like the cells (styles/cell.css .hit-mark)
  // (the zero-width space keeps the chip one text line high)
  if (HIT_LINES[rt.id]) return `<span class="hg-sym hg-sym-hit"><span class="hit-mark hit-${HIT_LINES[rt.id]}"></span>&#8203;</span>`;
  if (rt.id === 'STRIKEOUT_LOOK') return '<span class="hg-sym"><span class="sym-k sym-mirror">K</span></span>';
  if (rt.id === 'STRIKEOUT_SWING' || rt.id === 'STRIKEOUT_WILD') return '<span class="hg-sym"><span class="sym-k">K</span></span>';
  if (rt.batType && rt.category === 'out' && rt.id !== 'DOUBLE_PLAY' && rt.id !== 'INFIELD_FLY') return '';
  if (!rt.symbol) return '';
  const hit = rt.category === 'hit' ? ' hg-sym-hit' : '';
  return `<span class="hg-sym${hit}">${escapeHtml(rt.symbol)}</span>`;
}

// ============================================
// Building blocks
// ============================================

// The run mark as the cells draw it (red ●). The out count ●●○ of the status bar stays black.
const RUN = '<span class="hg-run" style="color:var(--color-red, #C62828)">●</span>';

function section(id, title, body) {
  return `<section class="hg-section" id="${id}"><h3>${title}</h3>${body}</section>`;
}

function block(title, body) {
  return `<div class="hg-block">${title ? `<h4>${title}</h4>` : ''}${body}</div>`;
}

function item(sampleHtml, titleHtml, example, note) {
  return `<div class="hg-item">${sampleHtml}<div class="hg-item-text">` +
    `<div class="hg-item-title">${titleHtml}</div>` +
    (example ? `<div class="hg-example">${escapeHtml(example)}</div>` : '') +
    (note ? `<p class="hg-note">${escapeHtml(note)}</p>` : '') +
    '</div></div>';
}

function figure(sampleHtml, caption) {
  return `<figure class="hg-figure">${sampleHtml}<figcaption>${caption}</figcaption></figure>`;
}

function sampleCell(cell, opts = {}) {
  return renderLegendSample(null, { ...opts, cell });
}

function mapDiagram() {
  const label = (cls, main, sub) => `<span class="hg-map-label ${cls}">${main}${sub ? `<small>${sub}</small>` : ''}</span>`;
  return '<div class="legend-cell legend-cell-lg hg-map" aria-hidden="true"><div class="cell-content wcell">' +
    '<div class="bg-line line-h-cross"></div><div class="bg-line line-v-cross"></div>' +
    '<div class="diamond-graphic"></div>' +
    label('q3', '三塁', '') + label('q2', '二塁', '') + label('q4', '本塁', '') +
    label('q1', '一塁', '打った結果') + label('qc', `<span class="hg-roman">Ⅰ</span>・${RUN}`, '') +
    '</div></div>';
}

// ============================================
// かんたんガイド
// ============================================

function basicsHTML() {
  const exampleCell = {
    resultType: 'SINGLE', positions: '7', rbi: 0, basesReached: 4, outNumber: null,
    runnerEvents: [{ type: 'STOLEN_BASE', base: 2 }, { type: 'WILD_PITCH', base: 3 }],
  };

  const howToRead = block('スコアブックの見方', `
    <p>表の1行が1人の打者（打順）、1列が1つの回です。1つのマスに、その打者がその回にしたこと（打った結果と、塁に出てからどうなったか）をまとめて書きます。</p>
    <div class="hg-row">
      ${mapDiagram()}
      <ul class="hg-list">
        <li><b>右下（一塁）</b>：打った結果</li>
        <li><b>右上・左上・左下</b>：二塁・三塁・本塁へ進んだ理由（盗塁など）</li>
        <li><b>赤い線</b>：その選手が進んだ塁</li>
        <li><b>真ん中</b>：<span class="hg-roman">Ⅰ Ⅱ Ⅲ</span>＝何アウト目か、${RUN}＝得点</li>
      </ul>
    </div>
    <div class="hg-row">
      ${renderLegendSample(null, { cell: exampleCell, large: true })}
      <p class="hg-example-box">このマスは「${escapeHtml(describeCell(exampleCell))}」という意味です。</p>
    </div>`);

  const fates = block('打者の行き先は3つだけ', `
    <p>打席に立った打者は、その回が終わるまでに必ず次のどれか1つになります。</p>
    <div class="hg-trio">
      ${figure(sampleCell({ resultType: 'SINGLE', positions: '7', basesReached: 4 }), `<b>得点</b><br>ホームに還った（${RUN}）`)}
      ${figure(sampleCell({ resultType: 'GROUNDOUT', positions: '6-3', outNumber: 1 }), '<b>アウト</b><br>真ん中に何アウト目か')}
      ${figure(sampleCell({ resultType: 'WALK', basesReached: 2 }), '<b>残塁</b><br>塁に残ったまま攻撃が終わった')}
    </div>
    <p>だから回が終わると、<b>打者の数 ＝ 得点 ＋ 残塁 ＋ アウト（3）</b> が必ず成り立ちます。アプリはこの計算で記録を確かめています。</p>`);

  const steps = block('アプリでの記録の手順', `
    <ol class="hg-steps">
      <li>画面上の「次: ○番」で今の打者を確かめて、その打者のマスをタップします（「次: ○番」をタップしても開きます）。</li>
      <li>打席の結果を選びます。アウトやヒットのときは、ボールを捕った選手 → 送球を受けた選手の順に守備番号のボタンを押します（ショートが捕って一塁へ投げたら 6 → 3）。</li>
      <li>塁に走者がいたら、ランナー欄で走者ごとにどこまで進んだかを選びます（そのまま／二塁／三塁／得点／アウト）。打点は自動で提案されます。</li>
      <li>画面に出る説明文（例:「${escapeHtml(describeCell({ resultType: 'GROUNDOUT', positions: '6-3', outNumber: 1 }))}」）が実際のプレーと合っているか確かめて、「確定」を押します。</li>
      <li>3アウトになると、自動で次の攻撃（チェンジ）に切り替わります。</li>
    </ol>
    <p class="hg-tip">間違えたときは、マスをもう一度タップして選び直すか、「クリア」で消してください。</p>`);

  const runs = block('得点と打点', `
    <p>走者がホームに還ったら、<b>その走者のマス</b>を「得点」にします。ランナー欄で「得点」を選ぶと自動で付き、マスの真ん中に ${RUN} が付きます。</p>
    <p><b>打点</b>は、走者を還した打者に付きます。</p>
    <div class="hg-trio hg-duo">
      ${figure(sampleCell({ resultType: 'SINGLE', positions: '7', basesReached: 4 }), '1番：ヒットで出て<br>ホームに還った（得点）')}
      ${figure(sampleCell({ resultType: 'DOUBLE', positions: '8', rbi: 1, basesReached: 2 }), '2番：二塁打で<br>1番を還した（打点1）')}
    </div>
    <ul class="hg-list">
      <li>チームの得点は ${RUN} の数です。打点は得点に足しません（同じ1点を2回数えてしまうため）。</li>
      <li>ホームランは打者自身にも ${RUN} が付き、打点は「還った走者の数＋1」です。</li>
      <li>打点が付かない得点：併殺打の間の得点、暴投・捕逸・ボーク・盗塁での生還、エラーでの生還など。</li>
    </ul>`);

  const outs = block('アウトの数え方と併殺', `
    <p>アウトは、<b>アウトになった本人のマス</b>に書きます。真ん中の <span class="hg-roman">Ⅰ Ⅱ Ⅲ</span> が、その回の何アウト目かを表します。盗塁死・牽制死も走者本人のマスに書きます。</p>
    <p>併殺（ダブルプレー）は、2つのマスに分けて書きます。打った打者のマスに <b>DP</b>、一緒にアウトになった走者のマスに <b>T.O</b>（走塁死）です。アプリで DP を選ぶと、アウトになった走者を選ぶ欄が出ます。</p>
    <div class="hg-trio hg-duo">
      ${figure(sampleCell({ resultType: 'SINGLE', positions: '8', basesReached: 1, outNumber: 1, runnerEvents: [{ type: 'RUNNER_OUT', base: 2 }] }), '走者：二塁でアウト<br>（1アウト目）')}
      ${figure(sampleCell({ resultType: 'DOUBLE_PLAY', positions: '6-4-3', outNumber: 2 }), '打者：併殺打<br>（2アウト目）')}
    </div>`);

  const runnerMoves = block('盗塁・暴投などで進んだとき', `
    <p>走者に起きたことは、<b>その走者のマス</b>に記録します（そのとき打席にいる打者のマスではありません）。進んだ塁の区画に記号が付きます（上の「スコアブックの見方」の例では、二塁の区画に S、三塁の区画に WP）。記号の意味は下の「走塁の記号」を見てください。</p>`);

  const screen = block('画面の見方', `
    <dl class="hg-dl">
      <dt>3回表</dt><dd>いま記録している回です。表は先攻チーム、裏は後攻チームの攻撃です。</dd>
      <dt>●●○</dt><dd>いまのアウトの数です。</dd>
      <dt>塁の図</dt><dd>いま塁にいる走者です。</dd>
      <dt>次: 5番</dt><dd>次に打つ打者です。タップすると、その打者のマスが開きます。</dd>
      <dt>回のまとめ</dt><dd>各回の得点欄をタップすると「打者5人：得点1・残塁1・アウト3 ✓」のように表示されます。✓ は人数の計算が合っている印です。</dd>
    </dl>`);

  const checks = block('記録チェック', `
    <p>入力した記録に矛盾がないかを、アプリが自動で調べます。</p>
    <ul class="hg-list">
      <li><b>✓ 記録チェックOK</b>：矛盾は見つかっていません。</li>
      <li><b>⚠ 2件</b>：タップすると内容が表示されます。項目をタップすると、そのマスに移動します。</li>
    </ul>
    <ul class="hg-levels">
      <li><span class="hg-level hg-level-error">エラー</span>記録として成り立ちません。直してください。</li>
      <li><span class="hg-level hg-level-warning">注意</span>たぶん間違いです。</li>
      <li><span class="hg-level hg-level-info">確認</span>念のため見直してください。</li>
    </ul>
    <p>よくある例：</p>
    <ul class="hg-list">
      <li>「打点が2なのに得点が1点」→ ホームに還った走者のマスを「得点」にし忘れていませんか。</li>
      <li>「アウトが2つしか記録されていません」→ 併殺や盗塁死でアウトになった走者の記入漏れはありませんか。</li>
      <li>「3アウトの後に打席が入っています」→ 次の回の欄に入れるはずではありませんか。</li>
      <li>「先頭打者は○番のはずです」→ 打順を飛ばしていませんか。</li>
    </ul>
    <p class="hg-tip">チェックで分かるのは記録どうしの矛盾です。ヒットかエラーかといった判定が正しいかどうかまでは分かりません。</p>`);

  return section('hg-basics', 'はじめての方へ：かんたんガイド',
    howToRead + fates + steps + runs + outs + runnerMoves + screen + checks);
}

// ============================================
// 記号ガイド
// ============================================

function positionsHTML() {
  const cells = Object.keys(POSITION_FIELD_NAMES).map(n =>
    `<div class="hg-pos"><span class="hg-pos-num">${escapeHtml(n)}</span><span>${escapeHtml(POSITIONS[n])}<small>${escapeHtml(POSITION_FIELD_NAMES[n])}</small></span></div>`
  ).join('');
  return block('守備番号', `<div class="hg-positions">${cells}</div>`);
}

function resultsHTML() {
  const groups = {};
  Object.values(RESULT_TYPES).forEach(rt => {
    (groups[rt.category] = groups[rt.category] || []).push(rt);
  });
  return Object.keys(CATEGORY_TITLES).filter(cat => groups[cat]).map(cat => {
    const items = groups[cat].map(rt => {
      const isPlaced = rt.id === 'TIEBREAK_RUNNER';
      const sample = isPlaced
        ? renderLegendSample(rt.id, { basesReached: 4, startBase: 2 })
        : renderLegendSample(rt.id, rt.id === 'SACRIFICE_FLY' ? { rbi: 1 } : {});
      const example = isPlaced ? '' : '例: ' + describeResult(rt.id, SAMPLE_POSITIONS[rt.id] || '');
      return item(sample, `${symbolChip(rt)}${escapeHtml(rt.label)}`, example, RESULT_NOTES[rt.id] || '');
    }).join('');
    const note = CATEGORY_NOTES[cat] ? `<p class="hg-cat-note">${escapeHtml(CATEGORY_NOTES[cat])}</p>` : '';
    return block(`打撃結果：${CATEGORY_TITLES[cat]}`, note + items);
  }).join('');
}

function runnerEventsHTML() {
  const items = Object.values(RUNNER_EVENTS).map(ev => {
    const s = RUNNER_SAMPLES[ev.id] || { base: 2, basesReached: ev.isOut ? 1 : 2, outNumber: ev.isOut ? 1 : null };
    const cell = {
      resultType: s.resultType || 'SINGLE', positions: s.positions || '7', rbi: 0,
      basesReached: s.basesReached, outNumber: ev.isOut ? s.outNumber : null,
      runnerEvents: [...(s.before || []), { type: ev.id, base: s.base }],
    };
    const chip = `<span class="hg-sym hg-sym-event" style="color:${ev.color};border-color:${ev.color}">${escapeHtml(ev.symbol)}</span>`;
    return item(sampleCell(cell), `${chip}${escapeHtml(ev.label)}`, '例: ' + describeCell(cell), RUNNER_NOTES[ev.id] || '');
  }).join('');
  return block('走塁の記号', '<p class="hg-cat-note">走者のマスの、その出来事が起きた塁の区画（二塁＝右上、三塁＝左上、本塁＝左下）に書きます。一塁での牽制死などは、右下の打撃結果の上に書きます。アウトの記号（赤地）が付いたマスには、真ん中に何アウト目かも書きます。</p>' + items);
}

function marksHTML() {
  return block('アウト番号・得点・チェンジ', `
    <div class="hg-trio">
      ${figure(sampleCell({ resultType: 'FLYOUT', positions: '8', outNumber: 1 }), '<span class="hg-roman">Ⅰ</span>＝1アウト目')}
      ${figure(sampleCell({ resultType: 'STRIKEOUT_SWING', outNumber: 2 }), '<span class="hg-roman">Ⅱ</span>＝2アウト目')}
      ${figure(sampleCell({ resultType: 'GROUNDOUT', positions: '6-3', outNumber: 3 }, { inningEnd: true }), '<span class="hg-roman">Ⅲ</span>＝3アウト目<br>右下の // はチェンジ')}
    </div>
    <ul class="hg-list">
      <li><b>${RUN}</b>：ホームに還った（得点）。</li>
      <li><b>赤い線</b>：その選手が進んだ塁。一塁までなら右下の1辺、ホームまでなら4辺すべて。</li>
      <li><b>//</b>：3つ目のアウトのマスの右下に付けて、その回の攻撃が終わったことを示します。</li>
    </ul>
    <p class="hg-tip">早稲田式の記号は、地域やチームによって少しずつ違います。このアプリでは、この一覧の書き方で記録・表示します。</p>`);
}

function symbolsHTML() {
  return section('hg-symbols', '記号ガイド',
    positionsHTML() + resultsHTML() + runnerEventsHTML() + marksHTML());
}

// ============================================
// Public API
// ============================================

// Full help markup (no DOM access; used by renderHelp and tests)
export function helpHTML() {
  const jump = '<nav class="hg-jump" aria-label="ガイドの目次">' +
    '<button type="button" class="hg-jump-btn" data-target="hg-basics">はじめての方へ</button>' +
    '<button type="button" class="hg-jump-btn" data-target="hg-symbols">記号の一覧</button>' +
    '</nav>';
  return `<div class="hg">${jump}${basicsHTML()}${symbolsHTML()}</div>`;
}

// Renders the guide into `container` (default: #help-content). Safe to call
// every time the page is shown.
export function renderHelp(container) {
  if (!container && typeof document !== 'undefined') container = document.getElementById('help-content');
  if (!container) return;
  container.innerHTML = helpHTML();
  if (container.dataset.helpBound) return;
  container.dataset.helpBound = '1';
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.hg-jump-btn');
    if (!btn) return;
    const target = container.querySelector('#' + btn.dataset.target);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
