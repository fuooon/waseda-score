// ============================================
// Score Input Panel (Modal)
// ============================================

import { RESULT_TYPES, RUNNER_EVENTS, POSITIONS, AtBatResult } from './data.js';

let currentCallback = null;

export function initScoreInput(game, teamKey, inning, batterIdx, callback) {
  currentCallback = callback;
  const lineup = game.getLineup(teamKey);
  const player = lineup[batterIdx] || {};
  const existingResult = game.getAtBat(teamKey, inning, batterIdx);

  const modal = document.getElementById('score-input-modal');
  const title = document.getElementById('score-input-title');
  const body = document.getElementById('score-input-body');

  title.textContent = `${inning}回 - ${batterIdx + 1}番 ${player.name || '---'}`;

  body.innerHTML = renderInputPanel(existingResult);
  bindInputEvents(body, existingResult);

  modal.classList.remove('hidden');

  document.getElementById('close-score-input').onclick = () => {
    modal.classList.add('hidden');
  };
}

function renderInputPanel(existingResult) {
  const categories = [
    {
      key: 'outs', class: 'category-outs', title: '⊘ アウト',
      items: ['GROUNDOUT', 'FLYOUT', 'LINEOUT', 'STRIKEOUT_SWING', 'STRIKEOUT_LOOK', 'DOUBLE_PLAY', 'INFIELD_FLY']
    },
    {
      key: 'hits', class: 'category-hits', title: '🏏 安打',
      items: ['SINGLE', 'DOUBLE', 'TRIPLE', 'HOMERUN']
    },
    {
      key: 'walks', class: 'category-walks', title: '🚶 四死球・犠打',
      items: ['WALK', 'HIT_BY_PITCH', 'SACRIFICE_BUNT', 'SACRIFICE_FLY']
    },
    {
      key: 'others', class: 'category-others', title: '📝 その他',
      items: ['ERROR', 'FIELDERS_CHOICE', 'INTERFERENCE']
    }
  ];

  let html = '<div class="score-input-categories">';

  for (const cat of categories) {
    html += `<div class="score-input-category ${cat.class}">`;
    html += `<h4>${cat.title}</h4>`;
    html += '<div class="score-input-buttons">';
    for (const key of cat.items) {
      const rt = RESULT_TYPES[key];
      const isSelected = existingResult?.resultType === key;
      html += `
        <button class="score-btn ${isSelected ? 'selected' : ''}" data-result="${key}">
          <span class="score-btn-symbol">${rt.symbol}</span>
          <span class="score-btn-label">${rt.label}</span>
        </button>
      `;
    }
    html += '</div></div>';
  }

  // Position selector area (hidden initially)
  html += `<div id="position-area" class="position-selector hidden">
    <h4>守備番号を入力</h4>
    <div class="score-detail-input">
      <label>守備経路（例: 6-3, 4-6-3）</label>
      <input type="text" id="position-detail-input" placeholder="6-3" value="${existingResult?.positions || ''}" />
    </div>
  </div>`;

  // RBI input
  html += `<div id="rbi-area" class="score-detail-input hidden">
    <label>打点</label>
    <input type="number" id="rbi-input" min="0" max="4" value="${existingResult?.rbi || 0}" />
  </div>`;

  // Bases reached selector
  html += `<div id="bases-area" class="position-selector hidden">
    <h4>到達した塁</h4>
    <div class="position-grid" style="grid-template-columns: repeat(5, 1fr);">
      <button class="position-btn base-btn" data-base="0">アウト</button>
      <button class="position-btn base-btn" data-base="1">一塁</button>
      <button class="position-btn base-btn" data-base="2">二塁</button>
      <button class="position-btn base-btn" data-base="3">三塁</button>
      <button class="position-btn base-btn" data-base="4">得点</button>
    </div>
  </div>`;

  // Runner Events section
  html += `<div class="runner-events-section">
    <h4>⚡ 走塁イベント</h4>
    <div class="runner-event-buttons">`;
  for (const [key, ev] of Object.entries(RUNNER_EVENTS)) {
    html += `<button class="runner-event-btn" data-event="${key}" style="border-color: ${ev.color}; color: ${ev.color};">
      <span class="runner-event-symbol">${ev.symbol}</span>
      <span class="runner-event-label">${ev.label}</span>
    </button>`;
  }
  html += `</div>
    <div id="runner-events-list" class="runner-events-list">`;
  // Render existing runner events
  if (existingResult?.runnerEvents?.length) {
    for (let i = 0; i < existingResult.runnerEvents.length; i++) {
      const re = existingResult.runnerEvents[i];
      const evDef = RUNNER_EVENTS[re.type];
      if (evDef) {
        html += `<div class="runner-event-item" data-index="${i}">
          <span class="runner-event-tag" style="background: ${evDef.color}">${evDef.symbol}</span>
          <span>${evDef.label}</span>
          <button class="runner-event-remove" data-remove="${i}">✕</button>
        </div>`;
      }
    }
  }
  html += `</div></div>`;

  // Action buttons
  html += `<div style="display:flex;gap:8px;margin-top:16px;">
    <button id="clear-result-btn" class="btn btn-secondary" style="flex:1;">クリア</button>
    <button id="confirm-result-btn" class="btn btn-primary score-confirm-btn" style="flex:2;">確定</button>
  </div>`;

  html += '</div>';
  return html;
}

function bindInputEvents(body, existingResult) {
  let selectedResult = existingResult?.resultType || null;
  let selectedBase = existingResult?.basesReached ?? null;
  let runnerEvents = existingResult?.runnerEvents ? [...existingResult.runnerEvents] : [];

  const positionArea = body.querySelector('#position-area');
  const rbiArea = body.querySelector('#rbi-area');
  const basesArea = body.querySelector('#bases-area');
  const posInput = body.querySelector('#position-detail-input');
  const rbiInput = body.querySelector('#rbi-input');
  const eventsList = body.querySelector('#runner-events-list');

  function updateVisibility() {
    if (selectedResult) {
      const rt = RESULT_TYPES[selectedResult];

      if (rt.needsPositions) {
        positionArea.classList.remove('hidden');
      } else {
        positionArea.classList.add('hidden');
      }

      if (!rt.isOut) {
        rbiArea.classList.remove('hidden');
        basesArea.classList.remove('hidden');

        // Pre-select base based on result type
        if (selectedBase === null && rt.bases !== undefined) {
          selectedBase = rt.bases;
          updateBaseSelection();
        }
      } else {
        rbiArea.classList.add('hidden');
        basesArea.classList.add('hidden');
        selectedBase = 0;
      }
    } else {
      positionArea.classList.add('hidden');
      rbiArea.classList.add('hidden');
      basesArea.classList.add('hidden');
    }
  }

  function updateBaseSelection() {
    body.querySelectorAll('.base-btn').forEach(btn => {
      btn.classList.toggle('selected', parseInt(btn.dataset.base, 10) === selectedBase);
    });
  }

  function renderRunnerEventsList() {
    let html = '';
    for (let i = 0; i < runnerEvents.length; i++) {
      const re = runnerEvents[i];
      const evDef = RUNNER_EVENTS[re.type];
      if (evDef) {
        html += `<div class="runner-event-item" data-index="${i}">
          <span class="runner-event-tag" style="background: ${evDef.color}">${evDef.symbol}</span>
          <span>${evDef.label}</span>
          <button class="runner-event-remove" data-remove="${i}">✕</button>
        </div>`;
      }
    }
    eventsList.innerHTML = html;
    // Rebind remove buttons
    eventsList.querySelectorAll('.runner-event-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        runnerEvents.splice(parseInt(btn.dataset.remove, 10), 1);
        renderRunnerEventsList();
      });
    });
  }

  // Result type buttons
  body.querySelectorAll('.score-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedResult = btn.dataset.result;
      selectedBase = null;
      body.querySelectorAll('.score-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updateVisibility();

      // Auto-fill positions hint
      const rt = RESULT_TYPES[selectedResult];
      if (rt.needsPositions && !posInput.value) {
        posInput.focus();
      }
    });
  });

  // Base buttons
  body.querySelectorAll('.base-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedBase = parseInt(btn.dataset.base, 10);
      updateBaseSelection();
    });
  });

  // Runner event buttons
  body.querySelectorAll('.runner-event-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      runnerEvents.push({ type: btn.dataset.event, description: '' });
      renderRunnerEventsList();
    });
  });

  // Remove runner event (initial render)
  eventsList.querySelectorAll('.runner-event-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      runnerEvents.splice(parseInt(btn.dataset.remove, 10), 1);
      renderRunnerEventsList();
    });
  });

  // Clear button
  body.querySelector('#clear-result-btn').addEventListener('click', () => {
    const modal = document.getElementById('score-input-modal');
    modal.classList.add('hidden');
    if (currentCallback) currentCallback(null);
  });

  // Confirm button
  body.querySelector('#confirm-result-btn').addEventListener('click', () => {
    if (!selectedResult && runnerEvents.length === 0) {
      alert('結果を選択してください');
      return;
    }

    const rt = selectedResult ? RESULT_TYPES[selectedResult] : null;
    const result = new AtBatResult({
      resultType: selectedResult,
      positions: posInput.value.trim(),
      rbi: parseInt(rbiInput.value, 10) || 0,
      basesReached: selectedBase ?? (rt?.isOut ? 0 : (rt?.bases || 0)),
      runnerEvents: runnerEvents,
    });

    const modal = document.getElementById('score-input-modal');
    modal.classList.add('hidden');
    if (currentCallback) currentCallback(result);
  });

  // Init visibility
  if (existingResult) {
    updateBaseSelection();
  }
  updateVisibility();
}
