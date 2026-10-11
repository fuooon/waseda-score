// ============================================
// Team Members Management
// ============================================
//
// This module owns the registered teams. Other modules read them through the
// getters below (never from their own copy), so a team added or renamed here
// is visible everywhere right away. refreshTeams() re-reads storage (after a
// backup was restored).

import { TeamMember, Team, saveTeams, loadTeams, loadMembers, POSITIONS, BAT_LABELS } from './data.js';
import { escapeHtml, showToast } from './util.js';

const DEFAULT_TEAM_NAME = 'マイチーム';

let teams = [];
let loaded = false;
let listenersBound = false;
let currentTeamId = null;
let editingMemberId = null;
let editingTeamId = null;

// ============================================
// Public API
// ============================================

export function initTeamMembers() {
  if (!loaded) loadFromStorage();
  bindEventsOnce();
  render();
}

// Re-reads the teams from storage (e.g. after restoring a backup).
export function refreshTeams() {
  loadFromStorage();
  render();
}

// Closes the add/edit dialogs of this page. Returns true when one was open.
export function closeTeamMemberModals() {
  if (typeof document === 'undefined') return false;
  const isOpen = id => !!document.getElementById(id) && !document.getElementById(id).classList.contains('hidden');
  const wasOpen = isOpen('member-modal') || isOpen('team-modal');
  if (wasOpen) {
    closeMemberModal();
    closeTeamModal();
  }
  return wasOpen;
}

export function getTeams() {
  if (!loaded) loadFromStorage();
  return teams;
}

export function getTeamById(id) {
  if (!id) return null;
  return getTeams().find(t => t.id === id) || null;
}

export function getMembers() {
  const team = getTeams().find(t => t.id === currentTeamId);
  return team ? team.members : [];
}

// Team names typed by hand may differ in width or spaces ("ファイターズ　" vs
// "ファイターズ"); compare them in this normalized form.
export function normalizeTeamName(name) {
  return String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function findTeamByName(name) {
  const wanted = normalizeTeamName(name);
  if (!wanted) return null;
  return getTeams().find(t => normalizeTeamName(t.name) === wanted) || null;
}

export function getMembersByTeamName(name) {
  const team = findTeamByName(name);
  return team ? team.members : [];
}

// Registered team of one side of a game: by the team id saved at setup (still
// found after the team is renamed), then by name (older games, names typed by hand).
export function findTeamForGame(game, teamKey) {
  if (!game) return null;
  const id = teamKey === 'second' ? game.teamSecondId : game.teamFirstId;
  const name = teamKey === 'second' ? game.teamSecond : game.teamFirst;
  return getTeamById(id) || findTeamByName(name);
}

export function getMembersForGame(game, teamKey) {
  const team = findTeamForGame(game, teamKey);
  return team ? team.members : [];
}

// ============================================
// Loading (with migration of the old single member list)
// ============================================

function loadFromStorage() {
  loaded = true;
  teams = loadTeams();
  if (teams.length === 0) {
    // Before teams existed, members were stored under 'waseda-score-members'.
    // Move them into the first team so they are not lost. The old key is left
    // untouched as a backup.
    const legacyMembers = loadMembers();
    teams.push(new Team({ name: DEFAULT_TEAM_NAME, members: legacyMembers }));
    saveTeams(teams);
  }
  if (!teams.some(t => t.id === currentTeamId)) {
    currentTeamId = teams[0].id;
  }
}

function persist() {
  // saveTeams shows a toast itself when storage fails; keep working from memory.
  return saveTeams(teams);
}

function render() {
  if (typeof document === 'undefined' || !document.getElementById('team-select')) return;
  renderTeamSelector();
  renderMemberList();
}

// ============================================
// Events (bound once)
// ============================================

function bindEventsOnce() {
  if (listenersBound || typeof document === 'undefined') return;
  listenersBound = true;
  const on = (id, type, fn) => document.getElementById(id)?.addEventListener(type, fn);

  // Members
  on('add-member-btn', 'click', () => openMemberModal());
  on('cancel-member-btn', 'click', closeMemberModal);
  on('member-form', 'submit', handleSaveMember);

  // Teams
  on('add-team-btn', 'click', () => openTeamModal());
  on('edit-team-btn', 'click', () => {
    const team = teams.find(t => t.id === currentTeamId);
    if (team) openTeamModal(team);
  });
  on('delete-team-btn', 'click', handleDeleteTeam);
  on('cancel-team-btn', 'click', closeTeamModal);
  on('team-form', 'submit', handleSaveTeam);
  on('team-select', 'change', (e) => {
    currentTeamId = e.target.value;
    renderMemberList();
  });

  // Member list (delegated: the list is re-rendered often)
  on('member-list', 'click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const team = teams.find(t => t.id === currentTeamId);
    const member = team?.members.find(m => m.id === btn.dataset.id);
    if (!member) return;
    if (btn.classList.contains('member-edit-btn')) openMemberModal(member);
    else if (btn.classList.contains('member-delete-btn')) deleteMember(member);
  });

  // Close the modals with a tap on the backdrop or Esc
  for (const [modalId, close] of [['member-modal', closeMemberModal], ['team-modal', closeTeamModal]]) {
    const modal = document.getElementById(modalId);
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('member-modal')?.classList.contains('hidden')) closeMemberModal();
    if (!document.getElementById('team-modal')?.classList.contains('hidden')) closeTeamModal();
  });
}

// ============================================
// Team Management
// ============================================

function renderTeamSelector() {
  const select = document.getElementById('team-select');
  select.innerHTML = teams.map(t =>
    `<option value="${escapeHtml(t.id)}"${t.id === currentTeamId ? ' selected' : ''}>${escapeHtml(t.name)}（${t.members.length}人）</option>`
  ).join('');
}

function openTeamModal(team = null) {
  editingTeamId = team ? team.id : null;
  const modal = document.getElementById('team-modal');
  const title = document.getElementById('team-modal-title');
  const input = document.getElementById('team-name-input');

  title.textContent = team ? 'チーム名を変更' : 'チームを追加';
  input.value = team ? team.name : '';

  modal.classList.remove('hidden');
  input.focus();
}

function closeTeamModal() {
  document.getElementById('team-modal')?.classList.add('hidden');
  editingTeamId = null;
}

function handleSaveTeam(e) {
  e.preventDefault();
  const name = document.getElementById('team-name-input').value.trim();
  if (!name) return;

  const same = teams.find(t => t.id !== editingTeamId && normalizeTeamName(t.name) === normalizeTeamName(name));
  if (same) {
    showToast(`「${name}」というチームはもうあります。別の名前にしてください。`, 'warning', 4000);
    return;
  }

  if (editingTeamId) {
    const team = teams.find(t => t.id === editingTeamId);
    if (team) team.name = name;
  } else {
    const newTeam = new Team({ name });
    teams.push(newTeam);
    currentTeamId = newTeam.id;
  }

  persist();
  render();
  closeTeamModal();
}

function handleDeleteTeam() {
  const team = teams.find(t => t.id === currentTeamId);
  if (!team) return;
  if (teams.length <= 1) {
    showToast('チームは最低1つ必要です。名前を変えて使ってください（✏️ボタン）。', 'warning', 4000);
    return;
  }
  const count = team.members.length;
  const message = count > 0
    ? `「${team.name}」と、登録されている選手${count}人をすべて削除しますか？\n（これまでの試合の記録は消えません）`
    : `「${team.name}」を削除しますか？`;
  if (!confirm(message)) return;

  teams = teams.filter(t => t.id !== currentTeamId);
  currentTeamId = teams[0].id;

  persist();
  render();
}

// ============================================
// Member Management
// ============================================

function openMemberModal(member = null) {
  editingMemberId = member ? member.id : null;
  const modal = document.getElementById('member-modal');
  const title = document.getElementById('member-modal-title');
  const team = teams.find(t => t.id === currentTeamId);

  title.textContent = member ? '選手の情報を変更' : `選手を追加${team ? `（${team.name}）` : ''}`;
  document.getElementById('member-name').value = member ? member.name : '';
  document.getElementById('member-number').value = member ? member.number : '';
  document.getElementById('member-bat').value = member && BAT_LABELS[member.bat] ? member.bat : 'right';
  document.getElementById('member-position').value = member && POSITIONS[member.position] ? member.position : '';

  modal.classList.remove('hidden');
  document.getElementById('member-name').focus();
}

function closeMemberModal() {
  document.getElementById('member-modal')?.classList.add('hidden');
  editingMemberId = null;
}

function handleSaveMember(e) {
  e.preventDefault();

  const name = document.getElementById('member-name').value.trim();
  const number = String(document.getElementById('member-number').value ?? '').trim();
  const bat = document.getElementById('member-bat').value;
  const position = document.getElementById('member-position').value;

  if (!name) return;

  const team = teams.find(t => t.id === currentTeamId);
  if (!team) return;

  if (editingMemberId) {
    const member = team.members.find(m => m.id === editingMemberId);
    if (member) Object.assign(member, { name, number, bat, position });
  } else {
    team.members.push(new TeamMember({ name, number, bat, position }));
  }

  persist();
  render();
  closeMemberModal();
  if (!editingMemberId) showToast(`${name} を登録しました`, 'success', 2000);
}

function deleteMember(member) {
  if (!confirm(`${member.name} を名簿から削除しますか？\n（これまでの試合の記録は消えません）`)) return;
  const team = teams.find(t => t.id === currentTeamId);
  if (!team) return;

  team.members = team.members.filter(m => m.id !== member.id);
  persist();
  render();
}

function renderMemberList() {
  const container = document.getElementById('member-list');
  const team = teams.find(t => t.id === currentTeamId);

  document.getElementById('current-team-name-display').textContent =
    team ? `${team.name} の選手` : '選手の一覧';

  if (!team || team.members.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <p>まだ選手が登録されていません。<br>「+ 選手を追加」から登録すると、スタメン入力で名前を選ぶだけで済みます。</p>
      </div>
    `;
    return;
  }

  container.innerHTML = team.members.map(m => {
    const posLabel = POSITIONS[m.position] || '';
    const batLabel = BAT_LABELS[m.bat] || '';
    const detail = [posLabel, batLabel ? `${batLabel}打ち` : ''].filter(Boolean).join(' / ');
    const id = escapeHtml(m.id);

    return `
      <div class="member-card" data-id="${id}">
        <div class="member-number-badge">${escapeHtml(m.number) || '-'}</div>
        <div class="member-info">
          <div class="name">${escapeHtml(m.name)}</div>
          <div class="detail">${escapeHtml(detail)}</div>
        </div>
        <div class="member-actions">
          <button type="button" class="member-edit-btn" data-id="${id}" title="変更" aria-label="${escapeHtml(m.name)}を変更">✏️</button>
          <button type="button" class="member-delete-btn" data-id="${id}" title="削除" aria-label="${escapeHtml(m.name)}を削除">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}
