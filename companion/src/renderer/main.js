import { Avatar } from './avatar.js';
import { AudioQueue } from './audio.js';

const api = window.companion;
const $ = (id) => document.getElementById(id);

// WebGL 을 쓸 수 없는 환경이어도 채팅은 동작하도록 한다
let avatar;
try {
  avatar = new Avatar($('stage'));
} catch (e) {
  console.error(e);
  avatar = { setMouth() {}, setEmotion() {}, setLook() {}, hitTest: async () => false, loadVrm: async () => false };
  setTimeout(() => { const s = $('status'); s.textContent = '3D 화면을 시작하지 못했어요 (채팅은 가능)'; s.classList.remove('hidden'); s.classList.add('error'); }, 0);
}
let busy = false;
let hideTimer = null;
let calmTimer = null;

// ───────── 오디오 + 립싱크 ─────────
const audio = new AudioQueue({
  onStart: () => { clearTimeout(hideTimer); clearTimeout(calmTimer); },
  onIdle: () => { if (!busy) scheduleCalm(); },
});
(function lipLoop() {
  avatar.setMouth(audio.level());
  requestAnimationFrame(lipLoop);
})();

function scheduleCalm() {
  clearTimeout(hideTimer);
  clearTimeout(calmTimer);
  hideTimer = setTimeout(() => $('bubble').classList.add('hidden'), 9000);
  calmTimer = setTimeout(() => avatar.setEmotion('neutral'), 4000);
}

// ───────── 채팅 ─────────
function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
  el.classList.toggle('error', isError);
}
function setBusy(v) {
  busy = v;
  $('btn-send').classList.toggle('hidden', v);
  $('btn-stop').classList.toggle('hidden', !v);
  $('input').disabled = v;
  if (!v) $('input').focus();
}

api.on('chat:text', (d) => {
  $('bubble').classList.remove('hidden');
  $('bubble-text').textContent += d;
  const b = $('bubble');
  b.scrollTop = b.scrollHeight;
});
api.on('chat:emotion', (e) => avatar.setEmotion(e));
api.on('chat:tool', (n) => setStatus({ save_memory: '기억하는 중…', forget_memory: '기억 정리 중…', open_url: '브라우저 여는 중…', open_app: '앱 실행 중…', look_at_screen: '화면 보는 중…' }[n] || `${n} 실행 중…`));
api.on('chat:audio', (a) => audio.enqueue(a.data));
api.on('chat:error', (m) => setStatus(m, true));

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  $('history').classList.add('hidden');
  clearTimeout(hideTimer);
  audio.stop();
  audio.resume();
  $('bubble-text').textContent = '';
  $('bubble').classList.add('hidden');
  setStatus('생각 중…');
  setBusy(true);
  const res = await api.chat(text);
  setBusy(false);
  setStatus(res.error || '', !!res.error);
  if (res.error && !$('bubble-text').textContent) {
    $('bubble').classList.remove('hidden');
    $('bubble-text').textContent = res.error;
  }
  if (!res.error) setStatus('');
  if (!audio.isActive()) scheduleCalm();
}

$('bar').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('input').value;
  $('input').value = '';
  send(v);
});
$('btn-stop').addEventListener('click', () => { api.cancel(); audio.stop(); });
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('settings').classList.contains('hidden')) closePanels();
  else if (busy) { api.cancel(); audio.stop(); }
  else closePanels();
});

// ───────── 대화 기록 패널 ─────────
async function toggleHistory() {
  const p = $('history');
  if (!p.classList.contains('hidden')) return p.classList.add('hidden');
  const { history } = await api.state();
  p.replaceChildren();
  if (!history.length) p.textContent = '아직 대화가 없어요.';
  for (const m of history) {
    const d = document.createElement('div');
    d.className = `m ${m.role}`;
    d.textContent = m.text;
    p.append(d);
  }
  p.classList.remove('hidden');
  p.scrollTop = p.scrollHeight;
}
$('btn-history').addEventListener('click', toggleHistory);

// ───────── 설정 패널 ─────────
const S = (id) => $(id);
async function openSettings() {
  $('history').classList.add('hidden');
  const { settings: c, hasApiKey } = await api.getSettings();
  const displays = await api.listDisplays();
  for (const id of ['s-display', 's-capture-display']) {
    S(id).replaceChildren(...displays.map((d) => new Option(d.label, String(d.index))));
  }
  S('key-state').textContent = hasApiKey ? '(저장됨)' : '(없음)';
  S('s-apikey').value = '';
  S('s-model').value = c.model;
  if (![...S('s-model').options].some((o) => o.value === c.model)) S('s-model').add(new Option(c.model, c.model, true, true));
  S('s-effort').value = c.effort;
  S('s-user').value = c.userName;
  S('s-char').value = c.characterName;
  S('s-extra').value = c.extraPrompt;
  S('s-vrm').value = c.vrmPath;
  S('s-display').value = String(c.window.display);
  S('s-ontop').checked = c.window.alwaysOnTop;
  S('s-clickthrough').checked = c.window.clickThrough;
  S('s-tts-on').checked = c.tts.enabled;
  S('s-tts-provider').value = c.tts.provider;
  S('s-edge-voice').value = c.tts.edge.voice;
  S('s-sbv2-url').value = c.tts.sbv2.url;
  S('s-sbv2-model').value = c.tts.sbv2.modelId;
  S('s-sbv2-speaker').value = c.tts.sbv2.speakerId;
  S('s-sbv2-lang').value = c.tts.sbv2.language;
  S('s-control').value = c.computerControl;
  S('s-capture').checked = c.screenCapture;
  S('s-capture-display').value = String(c.captureDisplay);
  S('s-backup-dir').value = c.backup.dir;
  S('s-backup-keep').value = c.backup.keep;
  S('settings-msg').textContent = '';
  await renderMemories();
  $('settings').classList.remove('hidden');
  updateCapture();
}
async function renderMemories() {
  const { memories } = await api.state();
  const box = $('memories');
  box.replaceChildren();
  const h = document.createElement('div');
  h.textContent = `장기 기억 ${memories.length}개`;
  box.append(h);
  for (const m of memories) {
    const row = document.createElement('div');
    row.className = 'mem';
    const t = document.createElement('span');
    t.textContent = m.content;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = '이 기억 삭제';
    del.addEventListener('click', async () => { await api.forgetMemory(m.id); renderMemories(); });
    row.append(t, del);
    box.append(row);
  }
}
function closePanels() {
  $('settings').classList.add('hidden');
  $('history').classList.add('hidden');
  updateCapture();
}
async function saveSettings() {
  const patch = {
    model: S('s-model').value,
    effort: S('s-effort').value,
    userName: S('s-user').value.trim(),
    characterName: S('s-char').value.trim() || '미나',
    extraPrompt: S('s-extra').value,
    vrmPath: S('s-vrm').value,
    window: { display: Number(S('s-display').value), alwaysOnTop: S('s-ontop').checked, clickThrough: S('s-clickthrough').checked },
    tts: {
      enabled: S('s-tts-on').checked,
      provider: S('s-tts-provider').value,
      edge: { voice: S('s-edge-voice').value.trim() },
      sbv2: { url: S('s-sbv2-url').value.trim(), modelId: Number(S('s-sbv2-model').value), speakerId: Number(S('s-sbv2-speaker').value), language: S('s-sbv2-lang').value.trim() },
    },
    computerControl: S('s-control').value,
    screenCapture: S('s-capture').checked,
    captureDisplay: Number(S('s-capture-display').value),
    backup: { dir: S('s-backup-dir').value, keep: Math.max(1, Number(S('s-backup-keep').value) || 14) },
  };
  const before = (await api.getSettings()).settings.vrmPath;
  const res = await api.setSettings(patch, S('s-apikey').value);
  if (!res.ok) { S('settings-msg').textContent = `저장 실패: ${res.error}`; return; }
  S('key-state').textContent = res.hasApiKey ? '(저장됨)' : '(없음)';
  S('s-apikey').value = '';
  S('settings-msg').textContent = '저장했어요.';
  if (before !== patch.vrmPath) await loadAvatar();
}
async function loadAvatar() {
  try {
    await avatar.loadVrm(await api.loadAvatar());
  } catch (e) {
    setStatus(`VRM 로딩 실패: ${e.message}`, true);
    await avatar.loadVrm(null);
  }
}

$('btn-settings').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', closePanels);
$('settings-save').addEventListener('click', saveSettings);
$('btn-quit').addEventListener('click', () => api.quit());
$('pick-vrm').addEventListener('click', async () => { const p = await api.pickVrm(); if (p) S('s-vrm').value = p; });
$('pick-backup').addEventListener('click', async () => { const p = await api.pickDir(); if (p) S('s-backup-dir').value = p; });
$('btn-backup').addEventListener('click', async () => {
  // 폴더를 방금 골랐다면 먼저 저장해야 반영된다
  await api.setSettings({ backup: { dir: S('s-backup-dir').value, keep: Number(S('s-backup-keep').value) || 14 } });
  const r = await api.backupNow();
  S('settings-msg').textContent = r.ok ? `백업 완료: ${r.file}` : `백업 실패: ${r.error}`;
});
$('btn-restore').addEventListener('click', async () => {
  const r = await api.restoreBackup();
  if (!r.ok) S('settings-msg').textContent = r.error;
});
$('btn-export').addEventListener('click', async () => {
  const r = await api.exportMemory();
  if (r.ok) S('settings-msg').textContent = `내보냈어요: ${r.file}`;
});
api.on('ui:openSettings', openSettings);
api.on('ui:clickThrough', () => {});

// ───────── 마우스: 클릭 통과 / 드래그 / 시선 ─────────
let overUi = false;
let overChar = false;
let dragging = null;
let lastCapture = null;
let probing = false;

function panelOpen() {
  return !$('settings').classList.contains('hidden') || !$('history').classList.contains('hidden');
}
function updateCapture() {
  const want = overUi || overChar || !!dragging || panelOpen();
  if (want !== lastCapture) { lastCapture = want; api.setIgnoreMouse(!want); }
}

window.addEventListener('pointermove', async (e) => {
  if (dragging) {
    api.setWindowPos(dragging.winX + (e.screenX - dragging.x), dragging.winY + (e.screenY - dragging.y));
    return;
  }
  overUi = !!e.target.closest?.('.ui');
  if (!overUi && !probing) {
    probing = true;
    overChar = await avatar.hitTest(e.clientX, e.clientY);
    probing = false;
  } else if (overUi) {
    overChar = false;
  }
  $('stage').style.cursor = overChar ? 'grab' : '';
  updateCapture();
});
document.addEventListener('pointerleave', () => { overUi = false; overChar = false; updateCapture(); });

$('stage').addEventListener('pointerdown', async (e) => {
  if (!overChar) return;
  const [winX, winY] = await api.getWindowPos();
  dragging = { x: e.screenX, y: e.screenY, winX, winY };
  $('stage').setPointerCapture(e.pointerId);
  $('stage').style.cursor = 'grabbing';
});
const endDrag = () => { if (dragging) { dragging = null; updateCapture(); } };
$('stage').addEventListener('pointerup', endDrag);
$('stage').addEventListener('pointercancel', endDrag);

// 데스크톱 어디에 있든 커서 쪽을 바라본다 (메인 프로세스가 창 기준 좌표를 보내 줌)
api.on('cursor', ({ x, y, w, h }) => avatar.setLook(((x - w / 2) / w) * 2.2, -((y - h * 0.3) / h) * 2));

// ───────── 시작 ─────────
(async function init() {
  await loadAvatar();
  const { hasApiKey } = await api.getSettings();
  if (!hasApiKey) {
    $('bubble').classList.remove('hidden');
    $('bubble-text').textContent = '안녕하세요! 먼저 ⚙ 설정에서 Anthropic API 키를 입력해 주세요.';
  }
  updateCapture();
  $('input').focus();
})();
