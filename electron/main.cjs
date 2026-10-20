// FormCoach desktop app: runs the built web app (dist/) in its own window, fully offline.
const { app, BrowserWindow, Menu, net, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'formcoach';
const DIST = path.join(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.task': 'application/octet-stream',
};

// For automated testing only: use Chrome's fake camera instead of the real webcam, and a
// throwaway data folder so tests never touch the user's real history and settings.
if (process.env.FORMCOACH_FAKE_CAMERA === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.setPath('userData', path.join(require('node:os').tmpdir(), 'formcoach-test-profile'));
}

// A "standard, secure" custom scheme behaves like https: camera access, fetch, IndexedDB and
// localStorage all work, and the origin stays the same between launches so history persists.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}

function start() {
  serveDist();
  lockDown(session.defaultSession);
  Menu.setApplicationMenu(null);
  createWindow();
}

/** Serves files from dist/ at app://formcoach/…, never outside it. */
function serveDist() {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = fs.readFileSync(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      return new Response(body, { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/** Camera only, and no network at all: nothing can leave this computer. */
function lockDown(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) =>
    callback({ cancel: true }),
  );
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const videoOnly = permission === 'media' && (details.mediaTypes ?? []).every((t) => t === 'video');
    callback(videoOnly);
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    minWidth: 820,
    minHeight: 600,
    title: 'FormCoach',
    backgroundColor: '#0f1115',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep tracking smooth when the window is behind another one.
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // F11 full screen; Ctrl+R reload. No other browser chrome.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.control && input.key.toLowerCase() === 'r') {
      win.webContents.reload();
      event.preventDefault();
    }
  });

  // Never navigate away from the app or open new windows.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.loadURL(`${SCHEME}://${HOST}/index.html`);
}

// Exposed for a quick sanity check that the build exists.
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('FormCoach: dist/ not found - run "npm run build" first.');
}
