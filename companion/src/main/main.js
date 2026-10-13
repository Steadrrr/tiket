const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen, shell, safeStorage, desktopCapturer, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { Brain } = require('../core/brain');
const { Memory } = require('../core/memory');

const DEV = !!process.env.COMPANION_DEV;
const DIST_HTML = path.join(__dirname, '../../dist/index.html');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let tray = null;
let brain = null;
let cursorTimer = null;

// ───────── API 키: OS 보안 저장소(Windows DPAPI)로 암호화해 보관, 환경변수는 폴백 ─────────
const keyFile = () => path.join(app.getPath('userData'), 'apikey.bin');
function loadApiKey() {
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(keyFile())) {
      return safeStorage.decryptString(fs.readFileSync(keyFile()));
    }
  } catch {}
  return process.env.ANTHROPIC_API_KEY || null;
}
function saveApiKey(key) {
  if (!key) return;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 PC에서는 API 키 암호화를 쓸 수 없어요. 환경변수 ANTHROPIC_API_KEY 를 사용해 주세요.');
  fs.writeFileSync(keyFile(), safeStorage.encryptString(key));
}

// ───────── 두뇌가 PC 앱에 요청하는 기능 ─────────
const platform = {
  async openUrl(url) {
    if (process.platform === 'win32') {
      try {
        await shell.openExternal(`microsoft-edge:${url}`); // Edge 로 열기 (셸을 거치지 않음)
        return;
      } catch {}
    }
    await shell.openExternal(url);
  },
  async launchApp(cmd) {
    const child = spawn(cmd, [], { detached: true, stdio: 'ignore', shell: false });
    child.on('error', () => {});
    child.unref();
  },
  async captureScreen(displayIndex) {
    const displays = screen.getAllDisplays();
    const d = displays[displayIndex] ?? screen.getPrimaryDisplay();
    const scale = Math.min(1, 1568 / Math.max(d.size.width, d.size.height));
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(d.size.width * d.scaleFactor * scale), height: Math.round(d.size.height * d.scaleFactor * scale) },
    });
    const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[displayIndex] ?? sources[0];
    if (!src) throw new Error('캡처할 화면을 찾지 못했어요.');
    return { mediaType: 'image/jpeg', base64: src.thumbnail.toJPEG(80).toString('base64') };
  },
};

async function confirm(message) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['허용', '거절'],
    defaultId: 1,
    cancelId: 1,
    title: '확인',
    message,
  });
  return response === 0;
}

// ───────── 창 ─────────
function placeWindow() {
  const cfg = brain.settings().window;
  const displays = screen.getAllDisplays();
  const d = displays[cfg.display] ?? screen.getPrimaryDisplay();
  const { x, y, width, height } = d.workArea;
  win.setBounds({ x: x + width - cfg.width - 16, y: y + height - cfg.height, width: cfg.width, height: cfg.height });
}

function createWindow() {
  const cfg = brain.settings().window;
  win = new BrowserWindow({
    width: cfg.width,
    height: cfg.height,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: cfg.alwaysOnTop,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  placeWindow();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!(DEV && url.startsWith('http://localhost:5173'))) e.preventDefault();
  });
  win.once('ready-to-show', () => win.show());
  if (DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(DIST_HTML);
  win.webContents.on('did-finish-load', () => applyClickThrough(brain.settings().window.clickThrough));

  // 데스크톱 어디에 있든 커서를 눈이 따라가게, 창 기준 커서 위치를 주기적으로 알려 준다
  let last = '';
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const msg = `${p.x - b.x},${p.y - b.y}`;
    if (msg === last) return;
    last = msg;
    win.webContents.send('cursor', { x: p.x - b.x, y: p.y - b.y, w: b.width, h: b.height });
  }, 50);
}

function applyClickThrough(on) {
  if (!win) return;
  // 클릭 통과 모드: 평소엔 마우스가 창을 통과하고, 캐릭터/UI 위에 올라가면 renderer 가 다시 잡는다
  win.setIgnoreMouseEvents(!!on, { forward: true });
  win.webContents.send('ui:clickThrough', !!on);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '../../assets/tray.png')));
  tray.setToolTip('데스크톱 동반자');
  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: win?.isVisible() ? '숨기기' : '보이기', click: () => { win.isVisible() ? win.hide() : win.show(); rebuild(); } },
        {
          label: '클릭 통과 (캐릭터 뒤 창 클릭 가능)',
          type: 'checkbox',
          checked: brain.settings().window.clickThrough,
          click: (item) => { brain.updateSettings({ window: { clickThrough: item.checked } }); applyClickThrough(item.checked); },
        },
        { label: '설정', click: () => { win.show(); win.webContents.send('ui:openSettings'); } },
        { type: 'separator' },
        { label: '종료', click: () => app.quit() },
      ]),
    );
  rebuild();
  tray.on('click', () => { win.isVisible() ? win.hide() : win.show(); rebuild(); });
}

// ───────── IPC ─────────
function wireIpc() {
  const send = (ch, ...a) => win && !win.isDestroyed() && win.webContents.send(ch, ...a);

  ipcMain.handle('brain:chat', async (_e, text) => {
    if (typeof text !== 'string' || !text.trim()) return { text: '' };
    return brain.chat(text.trim().slice(0, 4000), {
      onText: (d) => send('chat:text', d),
      onEmotion: (e) => send('chat:emotion', e),
      onToolUse: (n) => send('chat:tool', n),
      onAudio: (a) => send('chat:audio', { data: a.data, mime: a.mime, text: a.text }),
      onError: (m) => send('chat:error', m),
    });
  });
  ipcMain.handle('brain:cancel', () => brain.cancel());
  ipcMain.handle('brain:state', () => brain.state());

  ipcMain.handle('settings:get', () => ({ settings: brain.settings(), hasApiKey: !!loadApiKey(), platform: process.platform }));
  ipcMain.handle('settings:set', (_e, patch, apiKey) => {
    try {
      if (apiKey) saveApiKey(apiKey.trim());
      const next = brain.updateSettings(patch || {});
      if (patch?.window) { placeWindow(); win.setAlwaysOnTop(next.window.alwaysOnTop); applyClickThrough(next.window.clickThrough); }
      return { ok: true, settings: next, hasApiKey: !!loadApiKey() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('avatar:load', () => {
    const p = brain.settings().vrmPath;
    if (!p) return null;
    try {
      return fs.readFileSync(p);
    } catch {
      return null;
    }
  });
  ipcMain.handle('dialog:pickVrm', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'VRM 파일 선택', properties: ['openFile'], filters: [{ name: 'VRM', extensions: ['vrm'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:pickDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: '폴더 선택', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('window:displays', () =>
    screen.getAllDisplays().map((d, i) => ({ index: i, label: `${i + 1}번 모니터 (${d.size.width}×${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ' · 주' : ''}` })),
  );

  ipcMain.on('window:ignoreMouse', (_e, ignore) => {
    if (!win || win.isDestroyed()) return;
    // 클릭 통과 모드가 꺼져 있으면 항상 마우스를 받는다
    const on = brain.settings().window.clickThrough && ignore;
    win.setIgnoreMouseEvents(!!on, { forward: true });
  });
  ipcMain.handle('window:getPos', () => win.getPosition());
  ipcMain.on('window:setPos', (_e, x, y) => win && win.setPosition(Math.round(x), Math.round(y)));

  ipcMain.handle('backup:now', () => {
    try {
      return { ok: true, file: brain.backupNow() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('backup:restore', async () => {
    const dir = brain.settings().backup.dir;
    const r = await dialog.showOpenDialog(win, { title: '복원할 백업 선택', defaultPath: dir || undefined, properties: ['openFile'], filters: [{ name: 'SQLite 백업', extensions: ['sqlite'] }] });
    if (r.canceled) return { ok: false, error: '취소했어요.' };
    try {
      const probe = new Memory(r.filePaths[0]); // 유효한 백업인지 열어서 확인
      probe.listMemories();
      probe.recent(1);
      probe.close();
    } catch {
      return { ok: false, error: '올바른 백업 파일이 아니에요.' };
    }
    if (!(await confirm('현재 기억을 이 백업으로 덮어쓰고 앱을 다시 시작할까요?'))) return { ok: false, error: '취소했어요.' };
    const db = path.join(app.getPath('userData'), 'companion.sqlite');
    brain.memory.close();
    for (const ext of ['-wal', '-shm']) fs.rmSync(db + ext, { force: true });
    fs.copyFileSync(r.filePaths[0], db);
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });
  ipcMain.handle('memory:export', async () => {
    const r = await dialog.showSaveDialog(win, { title: '장기 기억 내보내기', defaultPath: 'companion-memory.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (r.canceled) return { ok: false };
    fs.writeFileSync(r.filePath, brain.exportMarkdown());
    return { ok: true, file: r.filePath };
  });
  ipcMain.handle('memory:forget', (_e, id) => brain.forgetMemory(id));
  ipcMain.on('app:quit', () => app.quit());
}

app.whenReady().then(() => {
  brain = new Brain({ dataDir: app.getPath('userData'), getApiKey: loadApiKey, platform, confirm });
  wireIpc();
  createWindow();
  createTray();
});

app.on('second-instance', () => win && (win.show(), win.focus()));
app.on('before-quit', () => {
  clearInterval(cursorTimer);
  try { brain?.close(); } catch {}
});
app.on('window-all-closed', () => app.quit());
