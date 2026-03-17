// ============================================
// Team Members Management
// ============================================

import { TeamMember, Team, saveTeams, loadTeams, POSITIONS, BAT_LABELS } from './data.js';

let teams = [];
let currentTeamId = null;
let editingMemberId = null;
let editingTeamId = null;

export function initTeamMembers() {
  teams = loadTeams();
  if (teams.length === 0) {
    const defaultTeam = new Team({ name: 'マイチーム' });
    teams.push(defaultTeam);
    saveTeams(teams);
  }
  
  if (!currentTeamId) {
    currentTeamId = teams[0].id;
  }
  
  renderTeamSelector();
  renderMemberList();
  bindEvents();
}

export function getTeams() {
  return teams;
}

export function getMembers() {
  const team = teams.find(t => t.id === currentTeamId);
  return team ? team.members : [];
}

export function getMembersByTeamName(name) {
  const team = teams.find(t => t.name === name);
  return team ? team.members : [];
}

function bindEvents() {
  // Member events
  document.getElementById('add-member-btn').onclick = () => openMemberModal();
  document.getElementById('cancel-member-btn').onclick = () => closeMemberModal();
  document.getElementById('member-form').onsubmit = handleSaveMember;

  // Team events
  document.getElementById('add-team-btn').onclick = () => openTeamModal();
  document.getElementById('edit-team-btn').onclick = () => {
    const team = teams.find(t => t.id === currentTeamId);
    if (team) openTeamModal(team);
  };
  document.getElementById('delete-team-btn').onclick = () => handleDeleteTeam();
  document.getElementById('cancel-team-btn').onclick = () => closeTeamModal();
  document.getElementById('team-form').onsubmit = handleSaveTeam;
  
  document.getElementById('team-select').onchange = (e) => {
    currentTeamId = e.target.value;
    renderMemberList();
  };
}

// --- Team Management ---

function renderTeamSelector() {
  const select = document.getElementById('team-select');
  select.innerHTML = teams.map(t => `
    <option value="${t.id}" ${t.id === currentTeamId ? 'selected' : ''}>${escapeHtml(t.name)}</option>
  `).join('');
}

function openTeamModal(team = null) {
  editingTeamId = team ? team.id : null;
  const modal = document.getElementById('team-modal');
  const title = document.getElementById('team-modal-title');
  const input = document.getElementById('team-name-input');

  title.textContent = team ? 'チーム名を編集' : 'チームを追加';
  input.value = team ? team.name : '';
  
  modal.classList.remove('hidden');
  input.focus();
}

function closeTeamModal() {
  document.getElementById('team-modal').classList.add('hidden');
  editingTeamId = null;
}

function handleSaveTeam(e) {
  e.preventDefault();
  const name = document.getElementById('team-name-input').value.trim();
  if (!name) return;

  if (editingTeamId) {
    const team = teams.find(t => t.id === editingTeamId);
    if (team) team.name = name;
  } else {
    const newTeam = new Team({ name });
    teams.push(newTeam);
    currentTeamId = newTeam.id;
  }

  saveTeams(teams);
  renderTeamSelector();
  renderMemberList();
  closeTeamModal();
}

function handleDeleteTeam() {
  if (teams.length <= 1) {
    alert('少なくとも1つのチームが必要です。');
    return;
  }
  if (!confirm('このチームと所属するメンバーをすべて削除しますか？')) return;

  teams = teams.filter(t => t.id !== currentTeamId);
  currentTeamId = teams[0].id;
  
  saveTeams(teams);
  renderTeamSelector();
  renderMemberList();
}

// --- Member Management ---

function openMemberModal(member = null) {
  editingMemberId = member ? member.id : null;
  const modal = document.getElementById('member-modal');
  const title = document.getElementById('member-modal-title');

  title.textContent = member ? 'メンバー編集' : 'メンバー追加';
  document.getElementById('member-name').value = member ? member.name : '';
  document.getElementById('member-number').value = member ? member.number : '';
  document.getElementById('member-bat').value = member ? member.bat : 'right';
  document.getElementById('member-position').value = member ? member.position : '';

  modal.classList.remove('hidden');
  document.getElementById('member-name').focus();
}

function closeMemberModal() {
  document.getElementById('member-modal').classList.add('hidden');
  editingMemberId = null;
}

function handleSaveMember(e) {
  e.preventDefault();

  const name = document.getElementById('member-name').value.trim();
  const number = document.getElementById('member-number').value;
  const bat = document.getElementById('member-bat').value;
  const position = document.getElementById('member-position').value;

  if (!name) return;

  const currentTeam = teams.find(t => t.id === currentTeamId);
  if (!currentTeam) return;

  if (editingMemberId) {
    const idx = currentTeam.members.findIndex(m => m.id === editingMemberId);
    if (idx !== -1) {
      currentTeam.members[idx].name = name;
      currentTeam.members[idx].number = number;
      currentTeam.members[idx].bat = bat;
      currentTeam.members[idx].position = position;
    }
  } else {
    const member = new TeamMember({ name, number, bat, position });
    currentTeam.members.push(member);
  }

  saveTeams(teams);
  renderMemberList();
  closeMemberModal();
}

function deleteMember(id) {
  if (!confirm('このメンバーを削除しますか？')) return;
  const currentTeam = teams.find(t => t.id === currentTeamId);
  if (!currentTeam) return;

  currentTeam.members = currentTeam.members.filter(m => m.id !== id);
  saveTeams(teams);
  renderMemberList();
}

function renderMemberList() {
  const container = document.getElementById('member-list');
  const currentTeam = teams.find(t => t.id === currentTeamId);
  
  document.getElementById('current-team-name-display').textContent = 
    currentTeam ? `${currentTeam.name} のメンバー` : 'メンバーリスト';

  if (!currentTeam || currentTeam.members.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <p>メンバーが登録されていません。<br>「+ メンバー追加」ボタンから登録しましょう。</p>
      </div>
    `;
    return;
  }

  container.innerHTML = currentTeam.members.map(m => {
    const posLabel = m.position ? POSITIONS[m.position] : '';
    const batLabel = BAT_LABELS[m.bat] || '';
    const detail = [posLabel, batLabel ? `${batLabel}打` : ''].filter(Boolean).join(' / ');

    return `
      <div class="member-card" data-id="${m.id}">
        <div class="member-number-badge">${m.number || '-'}</div>
        <div class="member-info">
          <div class="name">${escapeHtml(m.name)}</div>
          <div class="detail">${detail}</div>
        </div>
        <div class="member-actions">
          <button class="member-edit-btn" data-id="${m.id}" title="編集">✏️</button>
          <button class="member-delete-btn" data-id="${m.id}" title="削除">🗑️</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.member-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const member = currentTeam.members.find(m => m.id === btn.dataset.id);
      if (member) openMemberModal(member);
    });
  });

  container.querySelectorAll('.member-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteMember(btn.dataset.id));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
