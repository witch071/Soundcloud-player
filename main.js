const { app, BrowserWindow, WebContentsView, Menu, ipcMain, session, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { extractLinks, parseLink, buildConfig } = require('./vpn');
const adblock = require('./adblock');

const SOCKS_PORT = 10808;
const TOOLBAR_H = 40;
const DEFAULTS = { source: '', index: 0, autoConnect: false, adblock: true };
// хосты, которым разрешено открывать окна входа (Google, Apple, Facebook и т.д.)
const POPUP_HOSTS = /(^|\.)(soundcloud\.com|sndcdn\.com|google\.com|googleusercontent\.com|apple\.com|facebook\.com)$/i;
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';

let win, view, toolbar, settingsWin, xray = null, currentServer = null, settings = { ...DEFAULTS };

// ---------- настройки ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function persist(patch) {
  settings = { ...settings, ...patch };
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

// ---------- навигация ----------
const wc = () => view.webContents;
const canBack = () => wc().navigationHistory ? wc().navigationHistory.canGoBack() : wc().canGoBack();
const canForward = () => wc().navigationHistory ? wc().navigationHistory.canGoForward() : wc().canGoForward();
const goBack = () => { if (canBack()) (wc().navigationHistory ?? wc()).goBack(); };
const goForward = () => { if (canForward()) (wc().navigationHistory ?? wc()).goForward(); };

function pushState() {
  if (!toolbar || toolbar.webContents.isDestroyed() || !view) return;
  toolbar.webContents.send('nav:state', {
    back: canBack(), forward: canForward(), vpn: !!xray, adblock: settings.adblock
  });
}

ipcMain.on('nav:back', goBack);
ipcMain.on('nav:forward', goForward);
ipcMain.on('nav:reload', () => wc().reload());
ipcMain.on('nav:vpn', () => openSettings());
ipcMain.on('nav:adblock', () => { persist({ adblock: !settings.adblock }); wc().reload(); pushState(); });

// ---------- VPN (Xray) ----------
function xrayPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'xray', 'xray.exe')
    : path.join(__dirname, 'xray', 'xray.exe');
}

async function resolveServers(source) {
  source = (source || '').trim();
  if (!source) throw new Error('Вставь ключ или ссылку подписки');
  if (/^happ:\/\/crypt/i.test(source))
    throw new Error('Это зашифрованная ссылка Happ (happ://crypt…). Нужна обычная ссылка подписки (https://…) или vless:// ключ.');
  let text = source;
  if (/^https?:\/\//i.test(source)) {
    const r = await fetch(source, { headers: { 'User-Agent': 'Happ/2.0.0' } });
    if (!r.ok) throw new Error('Подписка вернула HTTP ' + r.status);
    text = await r.text();
  }
  const servers = extractLinks(text).map(parseLink).filter(Boolean);
  if (!servers.length) throw new Error('Не нашёл vless/trojan серверов в ключе');
  return servers;
}

function waitPort(port, timeout = 6000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() - t0 > timeout) reject(new Error('Xray не запустился (проверь ключ)'));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

async function stopVpn() {
  if (xray) { xray.removeAllListeners('exit'); xray.kill(); xray = null; }
  currentServer = null;
  await session.defaultSession.setProxy({ mode: 'direct' });
}

async function startVpn(source, index = 0) {
  await stopVpn();
  const servers = await resolveServers(source);
  const srv = servers[index] || servers[0];
  const exe = xrayPath();
  if (!fs.existsSync(exe)) throw new Error('Не найден ' + exe + ' — положи xray.exe в папку xray/');
  const cfg = path.join(app.getPath('userData'), 'xray.json');
  fs.writeFileSync(cfg, JSON.stringify(buildConfig(srv, SOCKS_PORT), null, 2));
  xray = spawn(exe, ['run', '-c', cfg], { windowsHide: true, cwd: path.dirname(exe) });
  xray.on('exit', () => {
    xray = null; currentServer = null;
    session.defaultSession.setProxy({ mode: 'direct' });
    settingsWin?.webContents.send('vpn:status', { connected: false, note: 'Xray остановился' });
    pushState();
  });
  await waitPort(SOCKS_PORT);
  await session.defaultSession.setProxy({ proxyRules: `socks5://127.0.0.1:${SOCKS_PORT}` });
  await session.defaultSession.closeAllConnections();
  currentServer = srv.name;
  view?.webContents.reload();
  return srv.name;
}

ipcMain.handle('vpn:state', () => ({ ...settings, connected: !!xray, server: currentServer }));
ipcMain.handle('vpn:list', async (_e, source) => {
  try { return { ok: true, names: (await resolveServers(source)).map(s => s.name) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('vpn:connect', async (_e, { source, index, autoConnect }) => {
  try {
    const name = await startVpn(source, index);
    persist({ source, index, autoConnect });
    pushState();
    return { ok: true, server: name };
  } catch (e) { await stopVpn(); pushState(); return { ok: false, error: e.message }; }
});
ipcMain.handle('vpn:disconnect', async () => { await stopVpn(); view?.webContents.reload(); pushState(); return { ok: true }; });

// ---------- окна ----------
function openSettings() {
  if (settingsWin) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 520, height: 560, parent: win, autoHideMenuBar: true, title: 'VPN / Прокси',
    backgroundColor: '#161616', icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => (settingsWin = null));
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  toolbar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_H });
  view.setBounds({ x: 0, y: TOOLBAR_H, width, height: Math.max(0, height - TOOLBAR_H) });
}

function setupSession() {
  const ses = session.defaultSession;
  // обычный Chrome UA без "Electron"
  ses.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
  adblock.install(ses, () => settings.adblock);
  // Google не пускает во встроенные браузеры — для его страниц входа подставляем UA Firefox
  ses.webRequest.onBeforeSendHeaders({ urls: ['*://accounts.google.com/*'] }, (details, cb) => {
    const h = details.requestHeaders;
    h['User-Agent'] = FIREFOX_UA;
    for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('sec-ch-ua')) delete h[k];
    cb({ requestHeaders: h });
  });
}

function createWindow() {
  setupSession();
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 800, minHeight: 520,
    title: 'SC Player', backgroundColor: '#121212', icon: path.join(__dirname, 'icon.ico')
  });

  toolbar = new WebContentsView({ webPreferences: {
    preload: path.join(__dirname, 'toolbar-preload.js'), contextIsolation: true, nodeIntegration: false } });
  view = new WebContentsView({ webPreferences: {
    contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.contentView.addChildView(view);
  win.contentView.addChildView(toolbar);
  layout();
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'show'])
    win.on(ev, layout);
  toolbar.webContents.loadFile('toolbar.html');
  toolbar.webContents.on('did-finish-load', pushState);

  view.webContents.loadURL('https://soundcloud.com');
  adblock.injectCss(view.webContents, () => settings.adblock);
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-finish-load', 'did-stop-loading'])
    view.webContents.on(ev, pushState);

  // окна входа через соцсети открываем внутри приложения (с общей сессией)
  view.webContents.setWindowOpenHandler(({ url }) => {
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    if (POPUP_HOSTS.test(host)) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 520, height: 720, parent: win, autoHideMenuBar: true, icon: path.join(__dirname, 'icon.ico') } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // боковые кнопки мыши «назад/вперёд»
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') goBack();
    else if (cmd === 'browser-forward') goForward();
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'VPN / Прокси…', accelerator: 'Ctrl+,', click: openSettings },
    { label: 'Навигация', submenu: [
      { label: 'Назад', accelerator: 'Alt+Left', click: goBack },
      { label: 'Вперёд', accelerator: 'Alt+Right', click: goForward },
      { label: 'Обновить', accelerator: 'F5', click: () => wc().reload() } ] },
    { label: 'Вид', submenu: [
      { label: 'Увеличить', accelerator: 'Ctrl+=', click: () => wc().setZoomLevel(wc().getZoomLevel() + 0.5) },
      { label: 'Уменьшить', accelerator: 'Ctrl+-', click: () => wc().setZoomLevel(wc().getZoomLevel() - 0.5) },
      { label: 'Сбросить масштаб', accelerator: 'Ctrl+0', click: () => wc().setZoomLevel(0) },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { label: 'Инструменты разработчика', accelerator: 'F12', click: () => wc().toggleDevTools() } ] }
  ]));
  layout();
  setTimeout(layout, 150);
  setTimeout(layout, 600);
}

app.whenReady().then(async () => {
  settings = loadSettings();
  if (settings.autoConnect && settings.source) { try { await startVpn(settings.source, settings.index); } catch {} }
  createWindow();
  setupUpdater();
});

// ---------- автообновление ----------
function setupUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['Перезапустить сейчас', 'Позже'], defaultId: 0,
      message: 'Доступна новая версия ' + info.version,
      detail: 'Перезапустить приложение, чтобы установить обновление?'
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

app.on('before-quit', () => { if (xray) { xray.removeAllListeners('exit'); xray.kill(); } });
app.on('window-all-closed', () => app.quit());
