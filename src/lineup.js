// ============================================
// Lineup (スタメン) — new game and edit mode
// ============================================
//
// mode 'new':  entering the lineups of a game that has not started. Every change
//              is saved at once (game.lineupDone = false), so a reload or a
//              discarded tab resumes on this page.
// mode 'edit': fixing names / numbers / positions / bats / pitchers of a game in
//              progress. Works on a copy; "保存して戻る" applies it. Records
//              (atBats) and substitutions are never touched, and the number of
//              batting slots never changes (cell keys depend on it).
//
// The batting order always has 9 slots, also with DH: the DH is a position of
// one of the 9 batters and the pitcher is entered separately. Legacy games
// saved with 10 slots keep them.

import { POSITIONS, BAT_LABELS, saveGame } from './data.js';
import { getMembersForGame, normalizeTeamName } from './team-members.js';
import { escapeHtml } from './util.js';

export const LINEUP_SIZE = 9;
const MANUAL = '__manual__';
const FIELD_POSITIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const TEAM_KEYS = ['first', 'second'];
const SIDE_LABELS = { first: '先攻', second: '後攻' };

let game = null;
let mode = 'new';
let work = null; // { first: { lineup, pitcher }, second: { lineup, pitcher } }
let currentTeam = 'first';
let callbacks = {};
let listenersBound = false;
let dirty = false;

const el = id => document.getElementById(id);

// ============================================
// Public API
// ============================================

// Shows the lineup page content for `game`. Safe to call many times: listeners
// are bound once, the game and callbacks are swapped.
//   callbacks: { onComplete(game), onBack(game), onEditDone(game), onEditCancel() }
//   options.mode: 'new' (default) | 'edit'
export function initLineup(gameRef, cbs = {}, { mode: newMode = 'new' } = {}) {
  game = gameRef;
  callbacks = cbs || {};
  mode = newMode === 'edit' ? 'edit' : 'new';
  currentTeam = 'first';
  dirty = false;
  work = {};
  for (const teamKey of TEAM_KEYS) {
    work[teamKey] = {
      lineup: copyLineup(lineupOf(game, teamKey)),
      pitcher: String((teamKey === 'first' ? game.pitcherFirst : game.pitcherSecond) || ''),
    };
  }
  bindEventsOnce();
  render();
}

export function getLineupMode() {
  return mode;
}

// Re-renders the visible form (e.g. players were registered meanwhile).
// What was entered is kept: every change is already in the working copy.
export function refreshLineup() {
  if (!game || !work) return;
  render();
}

// Asks before throwing away unsaved edits. Returns true when it is OK to leave.
export function lineupCanLeave() {
  if (mode !== 'edit' || !dirty) return true;
  if (!confirm('スタメンの変更を保存せずに戻りますか？')) return false;
  dirty = false;
  return true;
}

// Plain-language warnings for one team's lineup (never blocking).
//   returns [{ kind, text }]
export function lineupWarnings(lineup, { useDH = false, pitcher = '' } = {}) {
  const warnings = [];
  const rows = Array.isArray(lineup) ? lineup : [];
  const orders = list => list.map(i => `${i + 1}番`).join('・');

  const players = new Map();
  rows.forEach((p, i) => {
    const name = String(p?.name || '').trim();
    if (!name) return;
    const key = p.memberId && p.memberId !== MANUAL ? `id:${p.memberId}` : `name:${normalizeTeamName(name)}`;
    if (!players.has(key)) players.set(key, { name, idx: [] });
    players.get(key).idx.push(i);
  });
  for (const { name, idx } of players.values()) {
    if (idx.length > 1) warnings.push({ kind: 'duplicate-player', text: `同じ選手「${name}」が${orders(idx)}に入っています` });
  }

  const positions = new Map();
  rows.forEach((p, i) => {
    const pos = String(p?.position || '');
    if (!pos) return;
    if (!positions.has(pos)) positions.set(pos, []);
    positions.get(pos).push(i);
  });
  for (const [pos, idx] of positions) {
    if (idx.length > 1) warnings.push({ kind: 'duplicate-position', text: `守備位置「${positionLabel(pos)}」が${orders(idx)}で重なっています` });
  }
  // Missing positions only once every slot has a name (less noise while typing).
  const allNamed = rows.length > 0 && rows.every(p => String(p?.name || '').trim());
  if (positions.size > 0 && allNamed) {
    const required = useDH ? [...FIELD_POSITIONS.slice(1), 'DH'] : FIELD_POSITIONS;
    const missing = required.filter(pos => !positions.has(pos));
    if (missing.length) warnings.push({ kind: 'missing-position', text: `まだ決まっていない守備位置：${missing.map(positionLabel).join('・')}` });
  }
  if (!useDH && positions.has('DH')) {
    warnings.push({ kind: 'dh-without-dh', text: 'DH制ではない試合に「指名打者（DH）」の選手がいます' });
  }

  // Skipped slots (an empty slot above a filled one) are likely mistakes;
  // slots below the last name are simply not entered yet.
  const hasName = rows.map(p => !!String(p?.name || '').trim());
  const filled = hasName.filter(Boolean).length;
  const last = hasName.lastIndexOf(true);
  const skipped = hasName.map((v, i) => (!v && i < last ? i : -1)).filter(i => i >= 0);
  if (skipped.length) {
    warnings.push({ kind: 'missing-name', text: `名前が入っていない打順：${orders(skipped)}` });
  }
  if (useDH && filled > 0 && !String(pitcher || '').trim()) {
    warnings.push({ kind: 'missing-pitcher', text: 'DH制なので、先発投手を下の欄に入れてください（打順には入りません）' });
  }
  return warnings;
}

// ============================================
// Helpers
// ============================================

function lineupOf(g, teamKey) {
  const lineup = teamKey === 'first' ? g?.lineupFirst : g?.lineupSecond;
  return Array.isArray(lineup) ? lineup : [];
}

function copyLineup(lineup) {
  return lineup.map(p => ({ ...(p && typeof p === 'object' ? p : {}) }));
}

function blankEntry() {
  return { name: '', number: '', position: '', bat: 'right', memberId: '' };
}

function positionLabel(pos) {
  if (pos === 'DH') return '指名打者（DH）';
  return POSITIONS[pos] ? `${POSITIONS[pos]}（${pos}）` : String(pos);
}

// Number of batting slots shown for a team.
function rowCount(teamKey) {
  const original = lineupOf(game, teamKey);
  if (mode === 'edit') return original.length || LINEUP_SIZE; // never change N of a game in progress
  const lineup = work[teamKey].lineup;
  const extraNames = lineup.slice(LINEUP_SIZE).some(p => String(p?.name || '').trim());
  return extraNames ? lineup.length : LINEUP_SIZE;
}

function padded(teamKey) {
  const n = rowCount(teamKey);
  const lineup = work[teamKey].lineup.slice(0, n);
  while (lineup.length < n) lineup.push(blankEntry());
  return lineup.map(p => ({ ...blankEntry(), ...p }));
}

function teamLabel(teamKey) {
  const name = String((teamKey === 'first' ? game.teamFirst : game.teamSecond) || '').trim();
  return name || SIDE_LABELS[teamKey];
}

// "先攻：ファイターズ " or just "先攻" when the team has no name.
function teamTitle(teamKey) {
  const name = String((teamKey === 'first' ? game.teamFirst : game.teamSecond) || '').trim();
  return name ? `${SIDE_LABELS[teamKey]}：${name} ` : SIDE_LABELS[teamKey];
}

function members() {
  return getMembersForGame(game, currentTeam) || [];
}

function memberLabel(m) {
  return `${m.number !== '' && m.number !== undefined && m.number !== null ? `#${m.number} ` : ''}${m.name}`;
}

function positionChoices(lineup) {
  const choices = [...FIELD_POSITIONS];
  if (game.useDH || lineup.some(p => p.position === 'DH')) choices.push('DH');
  // Keep unknown legacy values selectable so they are not lost silently.
  for (const p of lineup) {
    if (p.position && !choices.includes(String(p.position))) choices.push(String(p.position));
  }
  return choices;
}

// ============================================
// Rendering
// ============================================

function render() {
  renderChrome();
  renderForm();
}

function renderChrome() {
  const editing = mode === 'edit';
  const title = el('lineup-title');
  if (title) title.textContent = editing ? 'スタメン編集' : 'スタメン登録';
  const hint = el('lineup-hint');
  if (hint) {
    hint.textContent = editing
      ? '名前・背番号・守備位置の入力ミスを直す画面です。試合の途中で選手が代わったときは、ここではなくスコアシートの🔄（選手交代）を使ってください。記録したプレーはそのまま残ります。'
      : '先攻・後攻それぞれの打順を入れてください。分からないところは空欄のままでも記録を始められます（あとから⚙️試合設定 →「スタメン編集」で直せます）。';
  }
  const back = el('lineup-back-btn');
  if (back) back.textContent = editing ? 'キャンセル' : '← 試合情報';
  const start = el('lineup-start-btn');
  if (start) start.textContent = editing ? '保存して戻る' : '記録開始 ⚾';
  el('page-lineup')?.classList.toggle('lineup-editing', editing);
  renderTabs();
}

function renderTabs() {
  for (const teamKey of TEAM_KEYS) {
    const tab = el(`lineup-tab-${teamKey}`);
    if (!tab) continue;
    const name = String((teamKey === 'first' ? game.teamFirst : game.teamSecond) || '').trim();
    const filled = work[teamKey].lineup.filter(p => String(p?.name || '').trim()).length;
    tab.innerHTML = `<span class="tab-side">${SIDE_LABELS[teamKey]}</span>` +
      (name ? `<span class="tab-team">${escapeHtml(name)}</span>` : '') +
      `<span class="tab-count">${filled}/${rowCount(teamKey)}人</span>`;
    tab.classList.toggle('active', teamKey === currentTeam);
    tab.setAttribute('aria-selected', String(teamKey === currentTeam));
  }
}

function renderForm() {
  const container = el('lineup-form-container');
  if (!container) return;
  const list = members();
  const lineup = padded(currentTeam);
  const posChoices = positionChoices(lineup);
  const memberIds = new Set(list.map(m => m.id));

  let html = `<div class="form-card lineup-card">
    <h3>${escapeHtml(teamTitle(currentTeam))}の打順</h3>
    ${list.length === 0 ? `<p class="lineup-note">登録されている選手がいないので、名前を手で入力します。<br>メニューの「👥 メンバー管理」で選手を登録すると、選ぶだけで入力できます。</p>` : ''}
    <div id="lineup-warnings" class="lineup-warnings" role="status" aria-live="polite"></div>`;

  lineup.forEach((entry, i) => {
    const selected = entry.memberId && memberIds.has(entry.memberId) ? entry.memberId
      : (entry.name ? MANUAL : '');
    const showManual = list.length === 0 || selected === MANUAL;
    html += `
    <div class="lineup-row" data-idx="${i}">
      <div class="lineup-order">${i + 1}</div>
      <div class="lineup-main">
        <div class="lineup-player-select">
          ${list.length > 0 ? `
          <select class="lineup-member-select" data-idx="${i}" aria-label="${i + 1}番の選手">
            <option value=""${selected === '' ? ' selected' : ''}>-- 選手を選ぶ --</option>
            ${list.map(m => `<option value="${escapeHtml(m.id)}" data-label="${escapeHtml(memberLabel(m))}"${selected === m.id ? ' selected' : ''}>${escapeHtml(memberLabel(m))}</option>`).join('')}
            <option value="${MANUAL}"${selected === MANUAL ? ' selected' : ''}>✏️ 名簿にない選手（手入力）</option>
          </select>` : ''}
          <input type="text" class="lineup-manual-input${showManual ? '' : ' hidden'}" data-idx="${i}"
            placeholder="${i + 1}番の選手名" aria-label="${i + 1}番の選手名" autocomplete="off" maxlength="24" enterkeyhint="next"
            value="${showManual ? escapeHtml(entry.name) : ''}" />
        </div>
        <div class="lineup-details">
          <input type="text" class="lineup-number-input" data-idx="${i}" inputmode="numeric" maxlength="3"
            placeholder="背番号" aria-label="${i + 1}番の背番号" autocomplete="off" value="${escapeHtml(entry.number)}" />
          <select class="lineup-pos-select" data-idx="${i}" aria-label="${i + 1}番の守備位置">
            <option value="">守備位置</option>
            ${posChoices.map(pos => `<option value="${escapeHtml(pos)}"${String(entry.position) === pos ? ' selected' : ''}>${escapeHtml(positionOptionLabel(pos))}</option>`).join('')}
          </select>
          <select class="lineup-bat-select" data-idx="${i}" aria-label="${i + 1}番の打ち方">
            ${Object.entries(BAT_LABELS).map(([value, label]) => `<option value="${value}"${(entry.bat || 'right') === value ? ' selected' : ''}>${label}打</option>`).join('')}
          </select>
        </div>
      </div>
    </div>`;
  });

  html += renderPitcherSection(list, lineup);
  html += '</div>';
  container.innerHTML = html;
  updateUsedMarks();
  renderWarnings();
}

function positionOptionLabel(pos) {
  if (pos === 'DH') return 'DH 指名打者';
  return POSITIONS[pos] ? `${pos} ${POSITIONS[pos]}` : String(pos);
}

function renderPitcherSection(list, lineup) {
  const pitcher = work[currentTeam].pitcher;
  const match = list.find(m => m.name === pitcher);
  const selected = match ? match.id : (pitcher ? MANUAL : '');
  const showManual = list.length === 0 || selected === MANUAL;
  const hint = game.useDH || lineup.some(p => p.position === 'DH')
    ? 'DH制なので、投手は打順に入りません。ここに入れてください。'
    : '守備位置を「1 投手」にした選手が自動で入ります。';
  return `
    <div class="lineup-pitcher-section">
      <h4>⚾ 先発投手</h4>
      <p class="lineup-pitcher-hint">${escapeHtml(hint)}</p>
      <div class="lineup-player-select">
        ${list.length > 0 ? `
        <select id="lineup-pitcher-select" class="lineup-pitcher-member-select" aria-label="先発投手">
          <option value=""${selected === '' ? ' selected' : ''}>-- 選手を選ぶ --</option>
          ${list.map(m => `<option value="${escapeHtml(m.id)}"${selected === m.id ? ' selected' : ''}>${escapeHtml(memberLabel(m))}</option>`).join('')}
          <option value="${MANUAL}"${selected === MANUAL ? ' selected' : ''}>✏️ 名簿にない選手（手入力）</option>
        </select>` : ''}
        <input type="text" id="lineup-pitcher-manual" class="lineup-manual-input${showManual ? '' : ' hidden'}"
          placeholder="投手の名前" aria-label="先発投手の名前" autocomplete="off" maxlength="24" value="${showManual ? escapeHtml(pitcher) : ''}" />
      </div>
    </div>`;
}

// Marks members already chosen in another slot: "#10 田中（3番）".
function updateUsedMarks() {
  const container = el('lineup-form-container');
  if (!container) return;
  const selects = [...container.querySelectorAll('.lineup-member-select')];
  const usedBy = new Map();
  selects.forEach(sel => {
    if (!sel.value || sel.value === MANUAL) return;
    if (!usedBy.has(sel.value)) usedBy.set(sel.value, []);
    usedBy.get(sel.value).push(Number(sel.dataset.idx));
  });
  selects.forEach(sel => {
    const idx = Number(sel.dataset.idx);
    for (const option of sel.options) {
      const label = option.dataset.label;
      if (label === undefined) continue;
      const others = (usedBy.get(option.value) || []).filter(i => i !== idx);
      option.textContent = others.length ? `${label}（${others.map(i => `${i + 1}番`).join('・')}）` : label;
    }
  });
}

function renderWarnings() {
  const box = el('lineup-warnings');
  if (!box) return;
  const lineup = work[currentTeam].lineup;
  const warnings = lineupWarnings(padded(currentTeam), { useDH: !!game.useDH, pitcher: work[currentTeam].pitcher });
  const filled = lineup.filter(p => String(p?.name || '').trim()).length;
  if (warnings.length) {
    box.className = 'lineup-warnings has-warnings';
    box.innerHTML = `<ul>${warnings.map(w => `<li>⚠ ${escapeHtml(w.text)}</li>`).join('')}</ul>`;
  } else if (filled >= rowCount(currentTeam)) {
    box.className = 'lineup-warnings is-ok';
    box.textContent = '✓ 打順がそろいました';
  } else {
    box.className = 'lineup-warnings';
    box.textContent = '';
  }
  renderTabs();
}

// ============================================
// Reading the form
// ============================================

function collectFromDom() {
  const container = el('lineup-form-container');
  if (!container || !work) return;
  const list = members();
  const previous = padded(currentTeam);
  const rows = [...container.querySelectorAll('.lineup-row')];
  const lineup = rows.map((row, i) => {
    const select = row.querySelector('.lineup-member-select');
    const manual = row.querySelector('.lineup-manual-input');
    let name = '';
    let memberId = '';
    if (select && select.value && select.value !== MANUAL) {
      const member = list.find(m => m.id === select.value);
      if (member) {
        name = member.name;
        memberId = member.id;
      }
    } else if (!select || select.value === MANUAL) {
      name = manual?.value.trim() || '';
      memberId = select ? MANUAL : '';
    }
    return {
      ...previous[i],
      name,
      memberId,
      number: row.querySelector('.lineup-number-input')?.value.trim() || '',
      position: row.querySelector('.lineup-pos-select')?.value || '',
      bat: row.querySelector('.lineup-bat-select')?.value || 'right',
    };
  });

  let pitcher = '';
  const pitcherSelect = container.querySelector('#lineup-pitcher-select');
  const pitcherManual = container.querySelector('#lineup-pitcher-manual');
  if (pitcherSelect && pitcherSelect.value && pitcherSelect.value !== MANUAL) {
    pitcher = list.find(m => m.id === pitcherSelect.value)?.name || '';
  } else if (!pitcherSelect || pitcherSelect.value === MANUAL) {
    pitcher = pitcherManual?.value.trim() || '';
  }

  // Without DH the starting pitcher is the batter playing position 1.
  if (!game.useDH) {
    const before = previous.find(p => p.position === '1' && p.name)?.name || '';
    const now = lineup.find(p => p.position === '1' && p.name)?.name || '';
    if (now && now !== pitcher && (!pitcher || pitcher === before)) {
      pitcher = now;
      showPitcher(pitcher);
    }
  }

  work[currentTeam] = { lineup, pitcher };
}

// Puts a pitcher name into the pitcher select / text box.
function showPitcher(name) {
  const container = el('lineup-form-container');
  const select = container?.querySelector('#lineup-pitcher-select');
  const manual = container?.querySelector('#lineup-pitcher-manual');
  const member = members().find(m => m.name === name);
  if (select) {
    select.value = member ? member.id : (name ? MANUAL : '');
    manual?.classList.toggle('hidden', select.value !== MANUAL);
  }
  if (manual && (!select || select.value === MANUAL)) manual.value = name;
}

// Reads the visible team, then saves the draft (new game) or marks the edit dirty.
function commit() {
  collectFromDom();
  if (mode === 'new') {
    applyWorkToGame({ pad: false });
    game.lineupDone = false;
    saveGame(game); // shows a toast itself on failure
  } else {
    dirty = true;
  }
  updateUsedMarks();
  renderWarnings();
}

function applyWorkToGame({ pad }) {
  for (const teamKey of TEAM_KEYS) {
    const lineup = pad ? padded(teamKey) : copyLineup(work[teamKey].lineup);
    if (teamKey === 'first') {
      game.lineupFirst = lineup;
      game.pitcherFirst = work.first.pitcher;
    } else {
      game.lineupSecond = lineup;
      game.pitcherSecond = work.second.pitcher;
    }
  }
}

// ============================================
// Events (bound once)
// ============================================

function bindEventsOnce() {
  if (listenersBound) return;
  listenersBound = true;

  el('lineup-tab-first')?.addEventListener('click', () => switchTeam('first'));
  el('lineup-tab-second')?.addEventListener('click', () => switchTeam('second'));
  el('lineup-start-btn')?.addEventListener('click', handleStart);
  el('lineup-back-btn')?.addEventListener('click', handleBack);

  const container = el('lineup-form-container');
  container?.addEventListener('change', handleChange);
  container?.addEventListener('input', (e) => {
    if (e.target.matches('.lineup-manual-input, .lineup-number-input')) commit();
  });
}

function handleChange(e) {
  if (!game) return;
  const target = e.target;
  if (target.matches('.lineup-member-select')) {
    onMemberChosen(target);
  } else if (target.matches('.lineup-pitcher-member-select')) {
    const manual = el('lineup-pitcher-manual');
    manual?.classList.toggle('hidden', target.value !== MANUAL);
    if (target.value === MANUAL) manual?.focus();
  } else if (!target.matches('.lineup-pos-select, .lineup-bat-select')) {
    return; // text inputs are handled on 'input'
  }
  commit();
}

// Choosing a registered player fills in number, bat and main position.
function onMemberChosen(select) {
  const row = select.closest('.lineup-row');
  const manual = row?.querySelector('.lineup-manual-input');
  const isManual = select.value === MANUAL;
  manual?.classList.toggle('hidden', !isManual);
  if (isManual) {
    manual?.focus();
    return;
  }
  const member = members().find(m => m.id === select.value);
  const numberInput = row?.querySelector('.lineup-number-input');
  if (!member) {
    if (numberInput) numberInput.value = '';
    return;
  }
  if (numberInput) numberInput.value = member.number ?? '';
  const bat = row?.querySelector('.lineup-bat-select');
  if (bat && BAT_LABELS[member.bat]) bat.value = member.bat;

  const pos = String(member.position || '');
  const posSelect = row?.querySelector('.lineup-pos-select');
  if (!pos || !posSelect || !POSITIONS[pos]) return;
  if (game.useDH && pos === '1') return; // with DH the pitcher does not bat
  const usedElsewhere = [...el('lineup-form-container').querySelectorAll('.lineup-pos-select')]
    .some(other => other !== posSelect && other.value === pos);
  if (!usedElsewhere) posSelect.value = pos;
}

function switchTeam(teamKey) {
  if (!game || teamKey === currentTeam) return;
  commit();
  currentTeam = teamKey;
  renderForm();
  renderTabs();
  el('lineup-tabs')?.scrollIntoView?.({ block: 'nearest' });
}

function handleBack() {
  if (!game) return;
  if (mode === 'edit') {
    callbacks.onEditCancel?.();
    return;
  }
  commit();
  callbacks.onBack?.(game);
}

function handleStart() {
  if (!game) return;
  commit();
  if (mode === 'edit') {
    applyWorkToGame({ pad: true });
    saveGame(game);
    dirty = false;
    callbacks.onEditDone?.(game);
    return;
  }

  const problems = [];
  let firstProblemTeam = null;
  for (const teamKey of TEAM_KEYS) {
    const lineup = padded(teamKey);
    const name = teamLabel(teamKey);
    const label = name === SIDE_LABELS[teamKey] ? name : `${SIDE_LABELS[teamKey]}（${name}）`;
    const before = problems.length;
    if (!lineup.some(p => String(p.name || '').trim())) {
      problems.push(`${label}の選手名が入っていません（打順の番号だけでも記録できます）`);
    }
    for (const w of lineupWarnings(lineup, { useDH: !!game.useDH, pitcher: work[teamKey].pitcher })) {
      if (w.kind === 'duplicate-player' || w.kind === 'duplicate-position') problems.push(`${label}：${w.text}`);
    }
    if (problems.length > before && !firstProblemTeam) firstProblemTeam = teamKey;
  }
  if (problems.length) {
    const message = '記録を始める前に確認してください。\n\n' + problems.map(p => `・${p}`).join('\n') +
      '\n\nこのまま記録を始めますか？（スタメンはあとから ⚙️試合設定 →「スタメン編集」で直せます）';
    if (!confirm(message)) {
      if (firstProblemTeam && firstProblemTeam !== currentTeam) switchTeam(firstProblemTeam);
      return;
    }
  }

  applyWorkToGame({ pad: true });
  game.lineupDone = true;
  saveGame(game);
  callbacks.onComplete?.(game);
}
