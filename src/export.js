// ============================================
// Image Export (html2canvas)
// ============================================

import html2canvas from 'html2canvas';
import { renderScoreboardForExport } from './scoreboard.js';

let currentGame = null;

export function initExport(game) {
  currentGame = game;

  document.getElementById('export-btn').style.display = '';
  document.getElementById('export-btn').addEventListener('click', openExportModal);
  document.getElementById('close-export-btn').addEventListener('click', closeExportModal);
  document.getElementById('export-full-btn').addEventListener('click', exportFull);
  document.getElementById('export-board-btn').addEventListener('click', exportBoard);
}

function openExportModal() {
  document.getElementById('export-modal').classList.remove('hidden');
  document.getElementById('export-preview').classList.add('hidden');
}

function closeExportModal() {
  document.getElementById('export-modal').classList.add('hidden');
}

async function exportFull() {
  const container = document.getElementById('scoresheet-container');
  if (!container) return;

  const exportWrapper = document.createElement('div');
  exportWrapper.style.padding = '32px';
  exportWrapper.style.backgroundColor = '#FFFEF9';
  exportWrapper.style.position = 'absolute';
  exportWrapper.style.left = '-9999px';
  exportWrapper.style.top = '-9999px';
  exportWrapper.style.display = 'flex';
  exportWrapper.style.flexDirection = 'column';

  const headerArea = document.createElement('div');
  headerArea.style.display = 'flex';
  headerArea.style.justifyContent = 'space-between';
  headerArea.style.marginBottom = '24px';
  headerArea.style.alignItems = 'flex-start';

  const titleArea = document.createElement('div');
  const dateStr = currentGame?.date ? new Date(currentGame.date).toLocaleDateString('ja-JP') : '';
  const fieldStr = currentGame?.field || '';
  titleArea.innerHTML = `<h2 style="margin:0;color:#2C2416;font-size:24px;">試合スコア</h2><p style="margin:8px 0 0 0;color:#5A4E3C;font-size:16px;">${dateStr} ${fieldStr}</p>`;
  
  const boardArea = document.createElement('div');
  boardArea.innerHTML = renderScoreboardForExport(currentGame);
  boardArea.style.transform = 'scale(0.85)';
  boardArea.style.transformOrigin = 'top right';

  headerArea.appendChild(titleArea);
  headerArea.appendChild(boardArea);

  const containerClone = container.cloneNode(true);
  
  exportWrapper.appendChild(headerArea);
  exportWrapper.appendChild(containerClone);
  document.body.appendChild(exportWrapper);

  try {
    const canvas = await html2canvas(exportWrapper, {
      backgroundColor: '#FFFEF9',
      scale: 2,
      useCORS: true,
      logging: false
    });
    showPreview(canvas);
  } catch (err) {
    console.error('Export error:', err);
    alert('画像の生成に失敗しました');
  } finally {
    if (exportWrapper.parentNode) {
      exportWrapper.parentNode.removeChild(exportWrapper);
    }
  }
}


async function exportBoard() {
  // Create temp element with styled scoreboard
  const temp = document.createElement('div');
  temp.style.cssText = 'position: absolute; left: -9999px; top: -9999px;';
  temp.innerHTML = renderScoreboardForExport(currentGame);
  document.body.appendChild(temp);

  try {
    const canvas = await html2canvas(temp.firstElementChild, {
      backgroundColor: '#FFFFFF',
      scale: 2,
      useCORS: true,
      logging: false
    });
    showPreview(canvas);
  } catch (err) {
    console.error('Export error:', err);
    alert('画像の生成に失敗しました');
  } finally {
    document.body.removeChild(temp);
  }
}

function showPreview(canvas) {
  const preview = document.getElementById('export-preview');
  const img = document.getElementById('export-image');
  preview.classList.remove('hidden');

  const dataUrl = canvas.toDataURL('image/png');
  img.src = dataUrl;

  // Download button
  const downloadBtn = document.getElementById('export-download-btn');
  downloadBtn.onclick = () => {
    const link = document.createElement('a');
    const date = currentGame.date || 'score';
    link.download = `score_${date}_${currentGame.teamFirst}_vs_${currentGame.teamSecond}.png`;
    link.href = dataUrl;
    link.click();
  };

  // Share button (Web Share API)
  const shareBtn = document.getElementById('export-share-btn');
  if (navigator.share && navigator.canShare) {
    shareBtn.style.display = '';
    shareBtn.onclick = async () => {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'score.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `${currentGame.teamFirst} vs ${currentGame.teamSecond}`,
            text: '試合結果',
            files: [file]
          });
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Share error:', err);
        }
      }
    };
  } else {
    shareBtn.style.display = 'none';
  }
}
