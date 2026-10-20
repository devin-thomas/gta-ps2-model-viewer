// Gun hall: all extracted PS2 GTA weapon models in one walkable room, plus a scripting API and a deterministic capture mode.
// Time is explicit everywhere: gun spin and camera paths are pure functions of scene time, so a capture is reproducible frame by frame.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => new V3().lerpVectors(a, b, t);

// ---- layout ------------------------------------------------------------------------------------------------------
const COL = 1.5, ROW = 1.5;          // metres between pedestals along x (weapon family) and z (game)
const PED_H = 0.62, HOVER = 1.1;    // pedestal height, gun centre height
const GUN_SIZE = 1.05;               // longest side of every gun, normalised
const SPIN = 0.45;                   // rad/s, about one turn every 14 s
const TILT = 0.12;                   // resting pitch so the top of the gun shows
const FAMILY_ORDER = ['colt45', 'deagle', 'uzi', 'shotgun', 'm4', 'ak47', 'sniper', 'rocket', 'missile', 'grenade', 'molotov', 'bomb', 'flame', 'bat'];

const canvas = document.getElementById('view');
const hudEl = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080c);
scene.fog = new THREE.FogExp2(0x07080c, 0.04);
const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 120);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

// ---- state --------------------------------------------------------------------------------------------------------
const S = {
  guns: [], gunById: {}, games: [], sceneT: 0, spin: SPIN, paused: false, hud: true, hovered: null,
  cam: { pos: new V3(-4.2, 1.7, ROW), yaw: 0, pitch: -0.12, fov: 55 }, tween: null, mode: 'interactive',
  fpsTarget: 120, uncapped: false,
};
const START = () => ({ pos: new V3(-4.2, 1.7, ROW), yaw: 0, pitch: -0.12, fov: 55 });
const keys = new Set();
let bounds = { x0: -7, x1: 10, z0: -3, z1: 6 };

// ---- helpers ------------------------------------------------------------------------------------------------------
function textTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function makeLabel(title, sub, accent) {
  const tex = textTexture(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(8,10,16,.72)'; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 14); g.fill();
    g.fillStyle = accent; g.fillRect(4, 18, 6, h - 36);
    g.fillStyle = '#eef2fb'; g.font = '600 46px "Segoe UI", sans-serif'; g.textBaseline = 'middle'; g.fillText(title, 26, 48);
    g.fillStyle = accent; g.font = '600 26px "Segoe UI", sans-serif'; g.fillText(sub, 26, 94);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
  sp.scale.set(0.84, 0.21, 1);
  return sp;
}
function accentColor(hex) { return new THREE.Color(hex); }

// ---- build the hall ---------------------------------------------------------------------------------------------
function buildHall(manifest) {
  S.games = manifest.games.filter((g) => manifest.guns.some((x) => x.game === g.id));
  const fams = FAMILY_ORDER.filter((f) => manifest.guns.some((g) => g.family === f))
    .concat([...new Set(manifest.guns.map((g) => g.family))].filter((f) => !FAMILY_ORDER.includes(f)));
  const maxCol = fams.length - 1;
  bounds = { x0: -7.5, x1: maxCol * COL + 4, z0: -3.2, z1: (S.games.length - 1) * ROW + 3.2 };

  const floorW = bounds.x1 - bounds.x0 + 12, floorD = bounds.z1 - bounds.z0 + 12;
  const gridTex = textTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#0b0e14'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,140,190,.20)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
    g.strokeStyle = 'rgba(120,140,190,.07)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
  });
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping; gridTex.repeat.set(floorW / 2, floorD / 2); gridTex.colorSpace = THREE.SRGBColorSpace; gridTex.anisotropy = 16;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD),
    new THREE.MeshStandardMaterial({ map: gridTex, roughness: 0.55, metalness: 0.3, envMapIntensity: 0.15 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set((bounds.x0 + bounds.x1) / 2, 0, (bounds.z0 + bounds.z1) / 2);
  scene.add(floor);

  scene.add(new THREE.HemisphereLight(0x8fa2c8, 0x0a0a12, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(-3, 6, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7aa2ff, 0.5); rim.position.set(5, 3, -4); scene.add(rim);

  const pedMat = new THREE.MeshStandardMaterial({ color: 0x232a3a, metalness: 0.7, roughness: 0.42 });
  const pedGeo = new THREE.CylinderGeometry(0.38, 0.43, PED_H, 40);
  const ringGeo = new THREE.TorusGeometry(0.4, 0.012, 8, 64);

  S.games.forEach((g, ri) => {
    const z = ri * ROW, acc = accentColor(g.accent);
    const len = maxCol * COL + 3.2;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.25),
      new THREE.MeshBasicMaterial({ color: acc, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }));
    strip.rotation.x = -Math.PI / 2; strip.position.set(len / 2 - 1.4, 0.004, z); scene.add(strip);
    for (const dz of [-0.625, 0.625]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.02), new THREE.MeshBasicMaterial({ color: acc, transparent: true, opacity: 0.7, fog: false }));
      edge.rotation.x = -Math.PI / 2; edge.position.set(len / 2 - 1.4, 0.006, z + dz); scene.add(edge);
    }
    for (let x = 0; x <= maxCol * COL; x += 4.2) {
      const pl = new THREE.PointLight(acc, 3, 6.5, 1.8); pl.position.set(x, 2.6, z); scene.add(pl);
    }
    const sign = textTexture(1024, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.font = '700 120px "Segoe UI", sans-serif'; c.textBaseline = 'middle';
      c.shadowColor = g.accent; c.shadowBlur = 36; c.fillStyle = g.accent; c.fillText(g.title, 20, h / 2 + 4);
      c.shadowBlur = 0; c.fillStyle = '#ffffff'; c.globalAlpha = 0.9; c.fillText(g.title, 20, h / 2 + 4);
    });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.425),
      new THREE.MeshBasicMaterial({ map: sign, transparent: true, depthWrite: false, fog: false }));
    decal.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V3(0, 0, 1), new V3(1, 0, 0), new V3(0, 1, 0)));
    decal.position.set(-2.4, 0.012, z); scene.add(decal);
  });

  const loaders = manifest.guns.map((m) => loadGun(m, fams, S.games, pedMat, pedGeo, ringGeo));
  return Promise.all(loaders);
}

function loadModel(objUrl) {
  const dir = objUrl.slice(0, objUrl.lastIndexOf('/') + 1), file = objUrl.slice(objUrl.lastIndexOf('/') + 1);
  return new Promise((resolve, reject) => {
    const mtl = new MTLLoader().setPath(dir);
    mtl.load(file.replace(/\.obj$/, '.mtl'), (mats) => {
      mats.preload();
      new OBJLoader().setMaterials(mats).setPath(dir).load(file, resolve, undefined, reject);
    }, undefined, reject);
  });
}

async function loadGun(m, fams, games, pedMat, pedGeo, ringGeo) {
  const obj = await loadModel(m.obj);
  obj.traverse((n) => {
    if (!n.isMesh) return;
    n.geometry = toCreasedNormals(n.geometry, 0.9);
    const old = Array.isArray(n.material) ? n.material[0] : n.material;
    const map = old.map || null;
    if (map) { map.magFilter = THREE.NearestFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.anisotropy = 8; map.colorSpace = THREE.SRGBColorSpace; }
    n.material = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : 0x9aa4b8, roughness: 0.5, metalness: 0.3,
      alphaTest: 0.35, side: THREE.DoubleSide, envMapIntensity: 0.9 });
  });
  // RenderWare is Z-up with the barrel along +X: stand it up, centre it, scale to a common size.
  if (m.game === 'gta3') obj.rotation.z = -Math.PI / 2;
  const wrap = new THREE.Group(); wrap.add(obj); wrap.rotation.x = -Math.PI / 2; wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap), size = box.getSize(new V3()), c = box.getCenter(new V3());
  wrap.position.copy(c).negate();
  const holder = new THREE.Group(); holder.add(wrap); holder.scale.setScalar(GUN_SIZE / Math.max(size.x, size.y, size.z));
  const pivot = new THREE.Group(); pivot.add(holder); pivot.rotation.order = 'YXZ';

  const gi = games.findIndex((g) => g.id === m.game), game = games[gi], col = fams.indexOf(m.family);
  const base = new V3(col * COL, 0, gi * ROW);
  const g = { id: m.id, game: m.game, gameTitle: game.title, family: m.family, name: m.name, row: gi, col, base,
    center: new V3(base.x, HOVER, base.z), pivot, phase: (col * 0.9 + gi * 2.1) % (Math.PI * 2), offYaw: 0, offPitch: 0, velYaw: 0, drag: false, meshes: [] };
  pivot.position.copy(g.center);
  const acc = accentColor(game.accent);
  const ped = new THREE.Mesh(pedGeo, pedMat); ped.position.set(base.x, PED_H / 2, base.z);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: acc, fog: false })); ring.rotation.x = Math.PI / 2; ring.position.set(base.x, PED_H + 0.002, base.z);
  const label = makeLabel(m.name, game.title, game.accent); label.position.set(base.x - 0.62, 0.3, base.z);
  scene.add(ped, ring, label, pivot); g.parts = [ped, ring, label, pivot];
  pivot.traverse((n) => { if (n.isMesh) { n.userData.gun = g; g.meshes.push(n); } });
  S.guns.push(g); S.gunById[g.id] = g;
}

function sortGuns() { S.guns.sort((a, b) => a.col - b.col || a.row - b.row); }
function gunYaw(g) { return g.phase + S.spin * S.sceneT + g.offYaw; }
function applyGunPose() {
  for (const g of S.guns) { g.pivot.rotation.y = gunYaw(g); g.pivot.rotation.x = TILT + g.offPitch; }
}

// ---- camera ------------------------------------------------------------------------------------------------------
function applyCamera() {
  const c = S.cam;
  camera.fov = c.fov; camera.position.copy(c.pos);
  const cp = Math.cos(c.pitch);
  camera.lookAt(c.pos.x + Math.cos(c.yaw) * cp, c.pos.y + Math.sin(c.pitch), c.pos.z + Math.sin(c.yaw) * cp);
  camera.updateProjectionMatrix();
}
function poseLookingAt(pos, look, fov) {
  const d = look.clone().sub(pos);
  return { pos: pos.clone(), yaw: Math.atan2(d.z, d.x), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), fov };
}
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; }
function tweenTo(pose, dur = 0.9) { S.tween = { from: { pos: S.cam.pos.clone(), yaw: S.cam.yaw, pitch: S.cam.pitch, fov: S.cam.fov }, to: pose, t: 0, dur }; }
function focusPose(g, dist = 2.0, aDeg = 180, h = 0.55) {
  const a = aDeg * Math.PI / 180;
  return poseLookingAt(new V3(g.center.x + Math.cos(a) * dist, g.center.y + h, g.center.z + Math.sin(a) * dist), g.center, 45);
}
function focusGun(g) { tweenTo(focusPose(g)); showCaption(g.name, g.gameTitle, 2.6); }
function stepTween(dt) {
  const tw = S.tween; if (!tw) return;
  tw.t = Math.min(1, tw.t + dt / tw.dur);
  const e = tw.t * tw.t * tw.t * (tw.t * (tw.t * 6 - 15) + 10);
  S.cam.pos.lerpVectors(tw.from.pos, tw.to.pos, e);
  S.cam.yaw = lerpAngle(tw.from.yaw, tw.to.yaw, e); S.cam.pitch = lerp(tw.from.pitch, tw.to.pitch, e); S.cam.fov = lerp(tw.from.fov, tw.to.fov, e);
  if (tw.t >= 1) S.tween = null;
}

// ---- caption overlay (second pass, same path for live and capture) ---------------------------------------------
const ovScene = new THREE.Scene(), ovCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const ovCanvas = document.createElement('canvas');
const ovTex = new THREE.CanvasTexture(ovCanvas); ovTex.colorSpace = THREE.SRGBColorSpace;
const ovMat = new THREE.MeshBasicMaterial({ map: ovTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
ovScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ovMat));
let cap = { title: '', sub: '', alpha: 0, target: 0, hold: 0, drawn: '' };
function drawCaption(w, h) {
  const key = `${cap.title}|${cap.sub}|${w}x${h}`; if (key === cap.drawn) return; cap.drawn = key;
  ovCanvas.width = w; ovCanvas.height = h;
  const g = ovCanvas.getContext('2d'); g.clearRect(0, 0, w, h);
  if (!cap.title && !cap.sub) { ovTex.needsUpdate = true; return; }
  const u = h / 1080, pad = 64 * u, y = h - 120 * u;
  const grad = g.createLinearGradient(0, h - 330 * u, 0, h); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,.72)');
  g.fillStyle = grad; g.fillRect(0, h - 330 * u, w, 330 * u);
  g.fillStyle = '#ffb02e'; g.fillRect(pad, y - 62 * u, 8 * u, 118 * u);
  g.textBaseline = 'alphabetic'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 12 * u;
  g.fillStyle = '#ffffff'; g.font = `700 ${58 * u}px "Segoe UI", sans-serif`; g.fillText(cap.title, pad + 28 * u, y - 4 * u);
  g.fillStyle = '#d3d9e6'; g.font = `500 ${32 * u}px "Segoe UI", sans-serif`; g.fillText(cap.sub, pad + 28 * u, y + 44 * u);
  ovTex.needsUpdate = true;
}
function showCaption(title, sub, hold = 0) { cap.title = title; cap.sub = sub; cap.target = (title || sub) ? 1 : 0; cap.hold = hold; }

function renderFrame() {
  const w = renderer.domElement.width, h = renderer.domElement.height;
  applyGunPose(); applyCamera();
  renderer.clear(); renderer.render(scene, camera);
  drawCaption(w, h); ovMat.opacity = cap.alpha;
  if (cap.alpha > 0.002) { renderer.clearDepth(); renderer.render(ovScene, ovCam); }
}

function resize() {
  if (S.mode === 'capture') return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); camera.aspect = w / h;
}
window.addEventListener('resize', resize);

// ---- scripted camera (capture specs and the scripting API share this) --------------------------------------------
function anchor(spec) {
  if (Array.isArray(spec)) return new V3(...spec);
  const s = spec.at; let p;
  if (s.startsWith('col:')) { const gs = S.guns.filter((g) => g.family === s.slice(4)); p = gs.reduce((a, g) => a.add(g.center), new V3()).divideScalar(gs.length); }
  else if (s.startsWith('row:')) { const gs = S.guns.filter((g) => g.game === s.slice(4)); p = gs.reduce((a, g) => a.add(g.center), new V3()).divideScalar(gs.length); }
  else p = S.gunById[s].center.clone();
  if (spec.off) p.add(new V3(...spec.off));
  return p;
}
const EASE = { linear: (u) => u, smooth: (u) => u * u * u * (u * (u * 6 - 15) + 10), in: (u) => u * u, out: (u) => 1 - (1 - u) * (1 - u) };
const pair = (v) => (Array.isArray(v) ? v : [v, v]);
function camFromSegment(seg, t) {
  const u = clamp((t - seg.t0) / Math.max(1e-6, seg.t1 - seg.t0), 0, 1), e = (EASE[seg.ease || 'smooth'])(u);
  if (seg.type === 'orbit') {
    const c = anchor({ at: seg.at, off: seg.centerOff }), a = lerp(seg.a0, seg.a1, e) * Math.PI / 180;
    const [r0, r1] = pair(seg.radius), [h0, h1] = pair(seg.height ?? 0.1), [f0, f1] = pair(seg.fov ?? 45), lo = seg.lookOff || [0, 0, 0];
    const r = lerp(r0, r1, e);
    return poseLookingAt(new V3(c.x + Math.cos(a) * r, c.y + lerp(h0, h1, e), c.z + Math.sin(a) * r), c.clone().add(new V3(...lo)), lerp(f0, f1, e));
  }
  const A = seg.from, B = seg.to ?? seg.from;
  const pos = lerpV(anchor(A.pos), anchor(B.pos), e), look = lerpV(anchor(A.look), anchor(B.look), e);
  return poseLookingAt(pos, look, lerp(A.fov ?? 50, B.fov ?? 50, e));
}
const matches = (g, e) => (e.startsWith('col:') ? g.family === e.slice(4) : e.startsWith('row:') ? g.game === e.slice(4) : g.id === e);
let shownKey = '';
function setOnly(list) { // hide every gun (and its pedestal) not matched by the list; null shows everything
  const key = list ? list.join('|') : ''; if (key === shownKey) return; shownKey = key;
  for (const g of S.guns) { const v = !list || list.some((e) => matches(g, e)); g.parts.forEach((o, i) => { o.visible = v && !(i === 2 && S.hideLabels); }); }
}
function segmentAt(spec, t) { let s = spec.segments[0]; for (const x of spec.segments) if (t >= x.t0) s = x; return s; }
function applySpecAt(spec, t) {
  const seg = segmentAt(spec, t), p = camFromSegment(seg, t);
  setOnly(seg.only || null);
  S.cam.pos.copy(p.pos); S.cam.yaw = p.yaw; S.cam.pitch = p.pitch; S.cam.fov = p.fov;
  if (seg.caption) {
    showCaption(seg.caption[0], seg.caption[1] || '');
    cap.alpha = clamp(Math.min((t - seg.t0) / 0.4, (seg.t1 - t) / 0.4), 0, 1);
  } else { cap.alpha = 0; }
}

// ---- interactive input --------------------------------------------------------------------------------------------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(S.guns.flatMap((g) => g.meshes), false)[0];
  return hit ? hit.object.userData.gun : null;
}
let ptr = null;
canvas.addEventListener('pointerdown', (ev) => {
  try { canvas.setPointerCapture(ev.pointerId); } catch {}
  S.tween = null;
  const g = ev.button === 0 ? pick(ev) : null;
  ptr = { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, gun: g, moved: 0, lastT: performance.now() };
  if (g) { g.drag = true; g.velYaw = 0; }
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (ev) => {
  if (!ptr) { S.hovered = pick(ev); canvas.style.cursor = S.hovered ? 'pointer' : 'grab'; return; }
  const dx = ev.clientX - ptr.x, dy = ev.clientY - ptr.y; ptr.x = ev.clientX; ptr.y = ev.clientY;
  ptr.moved = Math.hypot(ev.clientX - ptr.sx, ev.clientY - ptr.sy);
  const now = performance.now(), dtp = Math.max(1, now - ptr.lastT) / 1000; ptr.lastT = now;
  if (ptr.gun) {
    const g = ptr.gun; g.offYaw += dx * 0.011; g.offPitch = clamp(g.offPitch + dy * 0.008, -1.1, 1.1);
    g.velYaw = lerp(g.velYaw, (dx * 0.011) / dtp, 0.5);
  } else { S.cam.yaw += dx * 0.0035; S.cam.pitch = clamp(S.cam.pitch - dy * 0.0035, -1.45, 1.45); }
});
function endPointer(ev) {
  if (!ptr) return;
  if (ptr.gun) { ptr.gun.drag = false; if (ptr.moved < 5) { ptr.gun.velYaw = 0; focusGun(ptr.gun); } }
  ptr = null; canvas.classList.remove('dragging');
}
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault(); S.tween = null;
  const f = new V3(Math.cos(S.cam.yaw) * Math.cos(S.cam.pitch), Math.sin(S.cam.pitch), Math.sin(S.cam.yaw) * Math.cos(S.cam.pitch));
  S.cam.pos.addScaledVector(f, -ev.deltaY * 0.004);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

let focusIdx = -1;
function cycleFocus(dir) { focusIdx = (focusIdx + dir + S.guns.length) % S.guns.length; focusGun(S.guns[focusIdx]); }
window.addEventListener('keydown', (ev) => {
  if (ev.repeat && ev.code !== 'Tab') { keys.add(ev.code); return; }
  keys.add(ev.code);
  if (ev.code === 'Tab') { ev.preventDefault(); cycleFocus(ev.shiftKey ? -1 : 1); }
  else if (ev.code === 'KeyP') S.paused = !S.paused;
  else if (ev.code === 'KeyH') { S.hud = !S.hud; hudEl.style.display = S.hud ? '' : 'none'; }
  else if (ev.code === 'KeyR' || ev.code === 'Escape') { tweenTo(poseOf(START())); }
  else if (/^Digit[1-9]$/.test(ev.code)) {
    const gi = +ev.code.slice(5) - 1;
    if (S.games[gi]) tweenTo(poseLookingAt(new V3(-3.4, 1.55, gi * ROW), new V3(1.5, 1.2, gi * ROW), 60), 1.1);
  } else if (ev.code === 'F2') { S.fpsTarget = S.fpsTarget === 120 ? 60 : 120; }
});
window.addEventListener('keyup', (ev) => keys.delete(ev.code));
window.addEventListener('blur', () => keys.clear());
const poseOf = (p) => p;

const vel = new V3();
function stepInteractive(dt) {
  stepTween(dt);
  if (!S.paused) S.sceneT += dt;
  if (!S.tween) {
    const f = new V3(Math.cos(S.cam.yaw), 0, Math.sin(S.cam.yaw)), r = new V3(-Math.sin(S.cam.yaw), 0, Math.cos(S.cam.yaw));
    const want = new V3();
    if (keys.has('KeyW') || keys.has('ArrowUp')) want.add(f);
    if (keys.has('KeyS') || keys.has('ArrowDown')) want.sub(f);
    if (keys.has('KeyD') || keys.has('ArrowRight')) want.add(r);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) want.sub(r);
    if (keys.has('Space')) want.y += 1; if (keys.has('KeyC')) want.y -= 1;
    if (want.lengthSq() > 0) want.normalize().multiplyScalar((keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5.5 : 2.2));
    vel.lerp(want, 1 - Math.exp(-dt * 10));
    S.cam.pos.addScaledVector(vel, dt);
    S.cam.pos.x = clamp(S.cam.pos.x, bounds.x0, bounds.x1); S.cam.pos.z = clamp(S.cam.pos.z, bounds.z0, bounds.z1); S.cam.pos.y = clamp(S.cam.pos.y, 0.3, 5);
  }
  for (const g of S.guns) {
    if (g.drag) continue;
    g.offYaw += g.velYaw * dt; g.velYaw *= Math.exp(-dt * 2.4);
    g.offPitch *= Math.exp(-dt * 1.3);
  }
  // caption ease: shown while a hold timer runs, then fades out
  if (cap.hold > 0) { cap.hold -= dt; if (cap.hold <= 0) cap.target = 0; }
  cap.alpha += (cap.target - cap.alpha) * (1 - Math.exp(-dt * 8));
}

// ---- frame statistics / HUD ---------------------------------------------------------------------------------------
const ft = new Float32Array(480); let ftN = 0, hudT = 0;
function recordFrame(ms) { ft[ftN++ % ft.length] = ms; }
function stats() {
  const n = Math.min(ftN, ft.length); if (!n) return { fps: 0, ms: 0, low1: 0 };
  const a = Array.from(ft.subarray(0, n)).sort((x, y) => x - y), avg = a.reduce((s, v) => s + v, 0) / n;
  return { fps: 1000 / avg, ms: avg, low1: 1000 / a[Math.min(n - 1, Math.floor(n * 0.99))] };
}
function updateHud(now) {
  if (!S.hud || now - hudT < 250) return; hudT = now;
  const st = stats(), tgt = S.fpsTarget, cls = st.fps >= tgt * 0.97 ? 'ok' : st.fps >= tgt * 0.75 ? 'warn' : 'bad';
  hudEl.innerHTML = `<div class="fps ${cls}">${st.fps.toFixed(0)} fps</div>` +
    `<div>${st.ms.toFixed(2)} ms &nbsp; 1% low ${st.low1.toFixed(0)}</div>` +
    `<div id="bar"><i style="width:${clamp(st.fps / tgt, 0, 1) * 100}%"></i></div>` +
    `<div>target ${tgt} Hz (${(1000 / tgt).toFixed(2)} ms) &nbsp; ${S.uncapped ? 'uncapped' : 'vsync'}</div>` +
    `<div>${S.guns.length} guns &nbsp; ${renderer.info.render.triangles} tris &nbsp; ${renderer.info.render.calls} calls</div>` +
    `<div>${S.hovered ? `${S.hovered.gameTitle}: ${S.hovered.name}` : '&nbsp;'}</div>`;
}

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  if (S.mode !== 'interactive') return;
  const dt = Math.min(0.05, (now - last) / 1000); recordFrame(now - last); last = now;
  stepInteractive(dt); renderFrame(); updateHud(now);
}

// ---- capture ------------------------------------------------------------------------------------------------------
async function runCapture(spec) {
  S.mode = 'capture'; document.body.classList.add('capture');
  const w = spec.width || 1920, h = spec.height || 1080, fps = spec.fps || 120, N = Math.round((spec.duration ?? spec.segments.at(-1).t1) * fps);
  renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h;
  if (spec.spin !== undefined) S.spin = spec.spin;
  S.hideLabels = !!spec.hideLabels; shownKey = ' ';
  const gl = renderer.getContext(), px = new Uint8Array(w * h * 4);
  await window.gv.captureStart();
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const t = i / fps; S.sceneT = t + (spec.timeOffset || 0);
    applySpecAt(spec, t); renderFrame();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    await window.gv.frame(px);
    if (i % 240 === 0) window.gv.log(`frame ${i}/${N} (${(i / ((performance.now() - t0) / 1000) || 0).toFixed(0)} fps)`);
  }
  await window.gv.captureDone();
}

async function runBench(seconds, uncapped) {
  S.mode = 'bench'; S.hud = false; hudEl.style.display = 'none';
  const dts = []; let prev = performance.now(); const t0 = prev;
  await new Promise((res) => {
    function f(now) {
      dts.push(now - prev); prev = now;
      S.sceneT += 0.016; const a = (now - t0) / 1000 * 0.4;
      S.cam.pos.set(2 + Math.cos(a) * 3.5, 1.6, ROW + Math.sin(a) * 3.5); S.cam.yaw = a + Math.PI; S.cam.pitch = -0.1;
      renderFrame();
      if (now - t0 < seconds * 1000) requestAnimationFrame(f); else res();
    }
    requestAnimationFrame(f);
  });
  dts.shift(); const s = [...dts].sort((a, b) => a - b), avg = s.reduce((x, y) => x + y, 0) / s.length;
  const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  await window.gv.benchResult({ seconds, uncapped, frames: s.length, avgFps: +(1000 / avg).toFixed(1), medianMs: +s[s.length >> 1].toFixed(3),
    p99Ms: +s[Math.floor(s.length * 0.99)].toFixed(3), maxMs: +s.at(-1).toFixed(2), low1Fps: +(1000 / s[Math.floor(s.length * 0.99)]).toFixed(1),
    share120: +(s.filter((v) => v <= 1000 / 120 * 1.08).length / s.length).toFixed(3), size: [canvas.width, canvas.height],
    dpr: window.devicePixelRatio, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a' });
}

// ---- scripting API (window.viewer; reachable from main via the HTTP control port) -----------------------------------
const api = {
  ready: false,
  state: () => ({ mode: S.mode, sceneT: S.sceneT, spin: S.spin, paused: S.paused, fps: stats(), cam: { pos: S.cam.pos.toArray(), yaw: S.cam.yaw, pitch: S.cam.pitch, fov: S.cam.fov },
    guns: S.guns.map((g) => ({ id: g.id, name: g.name, game: g.gameTitle, center: g.center.toArray(), off: [+g.offYaw.toFixed(3), +g.offPitch.toFixed(3)] })), size: [canvas.width, canvas.height] }),
  cmd(name, a = {}) {
    switch (name) {
      case 'setCamera': { const p = a.look ? poseLookingAt(new V3(...a.pos), new V3(...a.look), a.fov ?? S.cam.fov) : { pos: new V3(...a.pos), yaw: a.yaw, pitch: a.pitch, fov: a.fov ?? S.cam.fov };
        S.tween = null; S.cam.pos.copy(p.pos); S.cam.yaw = p.yaw; S.cam.pitch = p.pitch; S.cam.fov = p.fov; return true; }
      case 'tweenCamera': { tweenTo(poseLookingAt(new V3(...a.pos), new V3(...a.look), a.fov ?? S.cam.fov), a.dur ?? 1); return true; }
      case 'focus': { const g = S.gunById[a.id]; if (!g) throw new Error(`unknown gun ${a.id}`);
        const pose = focusPose(g, a.dist ?? 2.0, a.angle ?? 180, a.h ?? 0.55); if (a.instant) { S.tween = null; S.cam.pos.copy(pose.pos); S.cam.yaw = pose.yaw; S.cam.pitch = pose.pitch; S.cam.fov = pose.fov; } else tweenTo(pose, a.dur ?? 0.9);
        showCaption(g.name, g.gameTitle, a.captionHold ?? 2.6); return true; }
      case 'setTime': S.sceneT = a.t; return true;
      case 'pause': S.paused = a.on ?? true; return true;
      case 'setSpin': S.spin = a.rad; return true;
      case 'rotateGun': { const g = S.gunById[a.id]; g.offYaw = a.yaw ?? g.offYaw; g.offPitch = a.pitch ?? g.offPitch; g.velYaw = 0; return true; }
      case 'caption': showCaption(a.title || '', a.sub || '', a.hold ?? 0); return true;
      case 'hud': S.hud = a.on ?? !S.hud; hudEl.style.display = S.hud ? '' : 'none'; return true;
      case 'render': { if (a.t !== undefined) S.sceneT = a.t; renderFrame(); return true; }
      case 'screenshot': { renderFrame(); return canvas.toDataURL('image/png'); }
      case 'pointer': canvas.dispatchEvent(new PointerEvent(a.type, { clientX: a.x, clientY: a.y, button: a.button ?? 0, pointerId: 1, bubbles: true })); return true;
      case 'key': window.dispatchEvent(new KeyboardEvent(a.type || 'keydown', { code: a.code, shiftKey: !!a.shift })); return true;
      case 'screenPos': { const g = S.gunById[a.id], v = g.center.clone().project(camera); return [(v.x * 0.5 + 0.5) * canvas.clientWidth, (-v.y * 0.5 + 0.5) * canvas.clientHeight]; }
      case 'only': setOnly(a.list || null); return true;
      case 'list': return S.guns.map((g) => g.id);
      default: throw new Error(`unknown command ${name}`);
    }
  },
};
window.viewer = api;

(async function main() {
  const init = await window.gv.init();
  S.fpsTarget = init.fpsTarget || 120; S.uncapped = !!init.uncapped;
  if (init.capture) { S.mode = 'capture'; } else resize();
  if (!init.manifest.guns.length) {
    document.getElementById('loading').innerHTML = 'No models found.<br>Run the extraction step first (docs/EXTRACTION.md), or pass <code>--assets &lt;dir&gt;</code>.';
    window.gv.log('no models found'); return;
  }
  await buildHall(init.manifest);
  sortGuns(); S.cam = START();
  if (!init.capture) { camera.aspect = window.innerWidth / window.innerHeight; resize(); }
  applyGunPose(); applyCamera(); renderFrame();
  document.getElementById('loading').classList.add('done');
  api.ready = true; await window.gv.ready();
  if (init.capture) { await runCapture(init.capture); return; }
  if (init.bench) { await runBench(init.bench, init.uncapped); return; }
  requestAnimationFrame(loop);
})().catch((e) => { window.gv.log('FATAL ' + (e && e.stack || e)); document.getElementById('loading').textContent = 'Error: ' + e; });
