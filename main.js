'use strict';
// Electron main process: window, asset protocol, scripting surfaces (CLI flags, HTTP control port, ffmpeg capture).
const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const DEFAULT_ASSETS = path.join(__dirname, 'models');

function parseArgs(argv) {
  const o = { assets: process.env.GUN_ASSETS || DEFAULT_ASSETS, capture: null, out: null, bench: 0, uncapped: false,
    controlPort: 0, width: 1600, height: 900, focus: false, fps: 0, crf: 0, fpsTarget: 120 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--assets') o.assets = next();
    else if (a === '--capture') o.capture = next();
    else if (a === '--out') o.out = next();
    else if (a === '--bench') o.bench = parseFloat(next());
    else if (a === '--uncapped') o.uncapped = true;
    else if (a === '--control-port') o.controlPort = parseInt(next(), 10);
    else if (a === '--width') o.width = parseInt(next(), 10);
    else if (a === '--height') o.height = parseInt(next(), 10);
    else if (a === '--target-fps') o.fpsTarget = parseFloat(next());
    else if (a === '--focus') o.focus = true;
    else if (a === '--fps') o.fps = parseFloat(next());
    else if (a === '--crf') o.crf = parseFloat(next());
  }
  return o;
}
const opts = parseArgs(process.argv.slice(app.isPackaged ? 1 : 2));
const captureMode = !!opts.capture;
{ // --log <file>: also append console output to a file (launching via noactivate.ps1 detaches stdout)
  const i = process.argv.indexOf('--log');
  if (i > 0) { const f = process.argv[i + 1], orig = console.log; fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true });
    console.log = (...a) => { orig(...a); try { fs.appendFileSync(f, a.map(String).join(' ') + '\n'); } catch {} }; }
}

// 120 Hz design: the page paints at the display refresh (vsync on). --uncapped removes the limiter for benchmarking.
if (opts.uncapped || captureMode) { app.commandLine.appendSwitch('disable-frame-rate-limit'); app.commandLine.appendSwitch('disable-gpu-vsync'); }
if (captureMode) app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.obj': 'text/plain', '.mtl': 'text/plain', '.css': 'text/css' };

function serve(req) {
  const u = new URL(req.url);
  const p = decodeURIComponent(u.pathname);
  const isAsset = p.startsWith('/assets/');
  const root = path.resolve(isAsset ? opts.assets : __dirname);
  const full = path.resolve(root, isAsset ? p.slice(8) : p.slice(1));
  if (full !== root && !full.startsWith(root + path.sep)) return new Response('forbidden', { status: 403 });
  return fs.promises.readFile(full).then(
    (buf) => new Response(buf, { headers: { 'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' } }),
    () => new Response('not found', { status: 404 }));
}

// ---- gun manifest: scanned from the extraction results tree -------------------------------------------------
const GAMES = [
  { id: 'gta3', title: 'GTA III', accent: '#4aa3ff' },
  { id: 'vc', title: 'VICE CITY', accent: '#ff4fa8' },
  { id: 'sa', title: 'SAN ANDREAS', accent: '#ffb02e' },
];
const FAMILY_ALIAS = { m16: 'm4', desert_eagle: 'deagle' };
const FAMILY_NAMES = { colt45: 'Colt 45', ak47: 'AK-47', m4: 'M4 / M16', deagle: 'Desert Eagle', uzi: 'Uzi', shotgun: 'Shotgun',
  sniper: 'Sniper Rifle', rocket: 'Rocket Launcher', missile: 'Missile', grenade: 'Grenade', molotov: 'Molotov', bomb: 'Bomb',
  flame: 'Flamethrower', bat: 'Baseball Bat' };
const SKIP = /gunflash|fingers|icon/i;

function buildManifest() {
  const guns = [];
  for (const g of GAMES) {
    const gdir = path.join(opts.assets, g.id);
    if (!fs.existsSync(gdir)) continue;
    for (const d of fs.readdirSync(gdir, { withFileTypes: true })) {
      if (!d.isDirectory() || !d.name.startsWith('obj_')) continue;
      const files = fs.readdirSync(path.join(gdir, d.name)).filter((f) => f.endsWith('.obj') && !SKIP.test(f));
      for (const f of files) {
        let raw;
        if (g.id === 'gta3') { const m = /^weapons_\d+_(.+)_l0\.obj$/.exec(f); if (!m) continue; raw = m[1]; }
        else raw = d.name.slice(4);
        const family = FAMILY_ALIAS[raw] || raw;
        guns.push({ id: `${g.id}/${family}`, game: g.id, family, name: FAMILY_NAMES[family] || family,
          obj: `/assets/${g.id}/${d.name}/${f}` });
      }
    }
  }
  return { games: GAMES, guns };
}

// ---- ffmpeg capture sink ---------------------------------------------------------------------------------------
let ff = null, ffDone = null;
function startFfmpeg(spec, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const { width, height, fps } = spec;
  const args = ['-y', '-nostdin', '-hide_banner', '-loglevel', 'warning', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`,
    '-framerate', String(fps), '-i', 'pipe:0',
    '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(spec.crf ?? 14), '-r', String(fps),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out];
  ff = spawn(process.env.FFMPEG || 'ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  ffDone = new Promise((res) => ff.on('close', (code) => res(code)));
  ff.stdin.on('error', () => {});
}

function createWindow(manifest) {
  const win = new BrowserWindow({
    width: opts.width, height: opts.height, useContentSize: true, show: false, backgroundColor: '#07080c',
    title: 'GTA PS2 Gun Viewer', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  if (captureMode) { win.setContentSize(1280, 720); }
  // Launched by hand (--focus) the window comes to the front; launched by scripts it opens without taking focus.
  win.once('ready-to-show', () => { if (captureMode) return; if (opts.focus) win.show(); else win.showInactive(); });
  win.loadURL('app://local/renderer/index.html');
  return win;
}

let readyResolve; const readyP = new Promise((r) => (readyResolve = r));

app.whenReady().then(async () => {
  protocol.handle('app', serve);
  const manifest = buildManifest();
  const captureSpec = captureMode ? JSON.parse(fs.readFileSync(opts.capture, 'utf8')) : null;
  if (captureSpec && opts.fps) captureSpec.fps = opts.fps;
  if (captureSpec && opts.crf) captureSpec.crf = opts.crf;
  const outFile = captureMode ? path.resolve(opts.out || path.join(__dirname, 'out', `${captureSpec.name || 'capture'}.mp4`)) : null;

  ipcMain.handle('init', () => ({ manifest, capture: captureSpec, bench: opts.bench, uncapped: opts.uncapped, fpsTarget: opts.fpsTarget }));
  ipcMain.handle('ready', () => { readyResolve(); return true; });
  ipcMain.handle('capture-start', () => { startFfmpeg(captureSpec, outFile); return true; });
  ipcMain.handle('frame', (_e, buf) => new Promise((res) => {
    const ok = ff.stdin.write(Buffer.from(buf));
    if (ok) res(true); else ff.stdin.once('drain', () => res(true));
  }));
  ipcMain.handle('capture-done', async () => {
    ff.stdin.end();
    const code = await ffDone;
    console.log(JSON.stringify({ capture: 'done', out: outFile, ffmpegExit: code }));
    setTimeout(() => app.exit(code === 0 ? 0 : 1), 50);
    return code;
  });
  ipcMain.handle('bench-result', (_e, r) => { console.log(JSON.stringify({ bench: r })); setTimeout(() => app.exit(0), 50); return true; });
  ipcMain.handle('log', (_e, msg) => { console.log('[renderer]', msg); return true; });

  const win = createWindow(manifest);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('[renderer:warn/error]', message); });

  if (opts.controlPort) {
    const run = (code) => win.webContents.executeJavaScript(code, true);
    http.createServer(async (req, res) => {
      const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(body); };
      try {
        await readyP;
        const url = new URL(req.url, 'http://x');
        if (req.method === 'GET' && url.pathname === '/state') return send(200, JSON.stringify(await run('window.viewer.state()')));
        if (req.method === 'GET' && url.pathname === '/screenshot') {
          const img = await win.webContents.capturePage();
          return send(200, img.toPNG(), 'image/png');
        }
        if (req.method === 'POST' && url.pathname === '/cmd') {
          let body = ''; for await (const c of req) body += c;
          const { name, args } = JSON.parse(body || '{}');
          const r = await run(`window.viewer.cmd(${JSON.stringify(name)}, ${JSON.stringify(args ?? {})})`);
          return send(200, JSON.stringify({ ok: true, result: r ?? null }));
        }
        if (req.method === 'POST' && url.pathname === '/quit') { send(200, '{"ok":true}'); return setTimeout(() => app.exit(0), 50); }
        send(404, '{"error":"routes: GET /state, GET /screenshot, POST /cmd {name,args}, POST /quit"}');
      } catch (e) { send(500, JSON.stringify({ error: String(e && e.message || e) })); }
    }).listen(opts.controlPort, '127.0.0.1', () => console.log(JSON.stringify({ control: `http://127.0.0.1:${opts.controlPort}` })));
  }
});

app.on('window-all-closed', () => app.quit());
