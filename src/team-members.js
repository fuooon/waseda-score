// ============================================
// Team Members Management
// ============================================

import { TeamMember, saveMembers, loadMembers, POSITIONS, BAT_LABELS } from './data.js';

let members = [];
let editingMemberId = null;

export function initTeamMembers() {
  members = loadMembers();
  renderMemberList();
  bindEvents();
}

export function getMembers() {
  return members;
}

function bindEvents() {
  document.getElementById('add-member-btn').addEventListener('click', () => openMemberModal());
  document.getElementById('cancel-member-btn').addEventListener('click', () => closeMemberModal());
  document.getElementById('member-form').addEventListener('submit', handleSaveMember);
}

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

  if (editingMemberId) {
    const idx = members.findIndex(m => m.id === editingMemberId);
    if (idx !== -1) {
      members[idx].name = name;
      members[idx].number = number;
      members[idx].bat = bat;
      members[idx].position = position;
    }
  } else {
    const member = new TeamMember({ name, number, bat, position });
    members.push(member);
  }

  saveMembers(members);
  renderMemberList();
  closeMemberModal();
}

function deleteMember(id) {
  if (!confirm('このメンバーを削除しますか？')) return;
  members = members.filter(m => m.id !== id);
  saveMembers(members);
  renderMemberList();
}

function renderMemberList() {
  const container = document.getElementById('member-list');

  if (members.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <p>メンバーが登録されていません。<br>「+ 追加」ボタンからメンバーを登録しましょう。</p>
      </div>
    `;
    return;
  }

  container.innerHTML = members.map(m => {
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
      const member = members.find(m => m.id === btn.dataset.id);
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
