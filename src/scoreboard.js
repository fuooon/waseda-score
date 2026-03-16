// ============================================
// Scoreboard - Inning-by-inning score display
// ============================================

export function renderScoreboard(container, game) {
  const innings = game.innings;
  const maxInning = getMaxInningWithData(game);

  let html = '<div style="display: flex; flex-direction: column; gap: 2px; font-size: 0.8rem;">';

  // Team rows
  ['first', 'second'].forEach(teamKey => {
    const teamName = game.getTeamName(teamKey);
    html += '<div class="score-summary-team">';
    html += `<div class="score-summary-name">${escapeHtml(teamName)}</div>`;
    html += '<div class="score-summary-runs">';

    for (let i = 1; i <= maxInning; i++) {
      const runs = game.getInningRuns(teamKey, i);
      const isCurrent = (i === game.currentInning) &&
        ((teamKey === 'first' && game.currentHalf === 'top') ||
         (teamKey === 'second' && game.currentHalf === 'bottom'));
      html += `<div class="score-summary-cell ${isCurrent ? 'active-cell' : ''}">${runs || (i <= maxInning ? '0' : '')}</div>`;
    }

    const total = game.getTotalRuns(teamKey);
    html += `<div class="score-summary-cell total">${total}</div>`;
    html += '</div></div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

export function renderScoreboardForExport(game) {
  const innings = game.innings;
  const maxInning = getMaxInningWithData(game);
  const date = game.date ? new Date(game.date).toLocaleDateString('ja-JP') : '';

  let html = `
    <div style="background: white; padding: 24px; font-family: 'Noto Sans JP', sans-serif; border-radius: 12px; min-width: 400px;">
      <div style="text-align: center; margin-bottom: 16px;">
        <div style="font-size: 1.4rem; font-weight: 700; color: #145C2E;">⚾ 試合結果</div>
        <div style="font-size: 0.85rem; color: #5A4E3C;">${date}${game.field ? ' @ ' + escapeHtml(game.field) : ''}</div>
      </div>
      <table style="border-collapse: collapse; width: 100%; font-size: 0.9rem;">
        <thead>
          <tr style="background: #1B7A3D; color: white;">
            <th style="padding: 8px 12px; text-align: left; border: 1px solid #145C2E;">チーム</th>
  `;

  for (let i = 1; i <= maxInning; i++) {
    html += `<th style="padding: 8px 6px; text-align: center; border: 1px solid #145C2E; min-width: 28px;">${i}</th>`;
  }
  html += `<th style="padding: 8px 8px; text-align: center; border: 1px solid #145C2E; background: #FF8F00; min-width: 32px;">計</th>`;
  html += `<th style="padding: 8px 8px; text-align: center; border: 1px solid #145C2E; background: #FF8F00; min-width: 32px;">安</th>`;
  html += `<th style="padding: 8px 8px; text-align: center; border: 1px solid #145C2E; background: #FF8F00; min-width: 32px;">失</th>`;
  html += '</tr></thead><tbody>';

  ['first', 'second'].forEach(teamKey => {
    const teamName = game.getTeamName(teamKey);
    const bgColor = teamKey === 'first' ? '#FDF6E3' : '#FFFEF9';
    html += `<tr style="background: ${bgColor};">`;
    html += `<td style="padding: 8px 12px; font-weight: 600; border: 1px solid #D4C9B4; white-space: nowrap;">${escapeHtml(teamName)}</td>`;

    for (let i = 1; i <= maxInning; i++) {
      const runs = game.getInningRuns(teamKey, i);
      html += `<td style="padding: 8px 6px; text-align: center; border: 1px solid #D4C9B4; font-weight: 500;">${runs}</td>`;
    }

    const total = game.getTotalRuns(teamKey);
    const hits = game.getHitCount(teamKey);
    const errors = game.getErrorCount(teamKey);

    html += `<td style="padding: 8px 8px; text-align: center; border: 1px solid #D4C9B4; font-weight: 700; background: #FFF3E0; font-size: 1.1rem;">${total}</td>`;
    html += `<td style="padding: 8px 8px; text-align: center; border: 1px solid #D4C9B4; font-weight: 600;">${hits}</td>`;
    html += `<td style="padding: 8px 8px; text-align: center; border: 1px solid #D4C9B4; font-weight: 600;">${errors}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  html += '<div style="text-align: center; margin-top: 12px; font-size: 0.75rem; color: #8B7D6B;">早稲田式スコアブック</div>';
  html += '</div>';
  return html;
}

function getMaxInningWithData(game) {
  let max = game.innings;
  for (const teamKey of ['first', 'second']) {
    for (let i = 1; i <= 12; i++) {
      const data = game.atBats[teamKey][i];
      if (data && Object.keys(data).length > 0) max = Math.max(max, i);
    }
  }
  return max;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
