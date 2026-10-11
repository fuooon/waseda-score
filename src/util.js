// ============================================
// Shared utilities (escaping, dates, ids, toast)
// ============================================

import './styles/util.css';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escapes text for both element content and quoted attribute values.
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // randomUUID throws outside secure contexts on some browsers
    }
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
}

// 'YYYY-MM-DD' for the given date in the device's local time zone.
export function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Parses 'YYYY-MM-DD' as a local date (new Date('YYYY-MM-DD') would be UTC).
export function parseLocalDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatDateJa(str) {
  const d = parseLocalDate(str);
  return d ? d.toLocaleDateString('ja-JP') : '';
}

let toastTimer = null;

// type: 'info' | 'success' | 'warning' | 'error'
export function showToast(message, type = 'info', durationMs = 3000) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `app-toast app-toast-${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), durationMs);
}
