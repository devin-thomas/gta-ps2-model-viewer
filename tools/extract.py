#!/usr/bin/env python3
"""Extract the weapon models from PS2 GTA III, Vice City and San Andreas disc images into OBJ + PNG.

    python tools/extract.py --gta3 "GTA III.iso" --vc "Vice City.iso" --sa "San Andreas.iso"

Any subset of the three games works. Output goes to ./models/<game>/obj_<weapon>/ (the layout the viewer reads).
The disc images are only read, never modified. Needs: Python 3.9+, git, and a g++ (MinGW-w64 / MSYS2 on Windows).
The first run clones and builds aap/librw + aap/librwgta (convdff, convtxd) into ./work/.
"""
import argparse, glob, hashlib, json, os, shutil, struct, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from iso9660 import ISO          # noqa: E402
import dff2obj                    # noqa: E402

LIBRW = ('https://github.com/aap/librw', '18532c2e13efbc1aa43f0b00b4459831f9414de0')
LIBRWGTA = ('https://github.com/aap/librwgta', 'eb06ee545af46298696532b6f394cf83ac1337c3')
EXE = '.exe' if os.name == 'nt' else ''

# Weapons that ship as their own <name>.dff + <name>.txd inside the game's IMG archive.
IMG_WEAPONS = {
    'vc': ['colt45', 'ak47', 'm4'],
    'sa': ['colt45', 'ak47', 'm4', 'desert_eagle'],
}
SECTOR = 2048


def log(*a):
    print('[extract]', *a, flush=True)


def run(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f'command failed ({r.returncode}): {" ".join(cmd)}\n{r.stdout}\n{r.stderr}')
    return r.stdout


# ---- tools: convdff / convtxd ---------------------------------------------------------------------------------
def fetch_pinned(url, sha, dest):
    if os.path.isdir(os.path.join(dest, '.git')):
        return
    os.makedirs(dest, exist_ok=True)
    run(['git', 'init', '-q', dest])
    run(['git', '-C', dest, 'fetch', '-q', '--depth', '1', url, sha])
    run(['git', '-C', dest, 'checkout', '-q', 'FETCH_HEAD'])


def build_tools(work, gxx):
    bindir = os.path.join(work, 'bin')
    convdff, convtxd = (os.path.join(bindir, n + EXE) for n in ('convdff', 'convtxd'))
    if os.path.exists(convdff) and os.path.exists(convtxd):
        return convdff, convtxd
    log('building convdff and convtxd from aap/librw + aap/librwgta (about a minute)')
    fetch_pinned(*LIBRW, os.path.join(work, 'src', 'librw'))
    fetch_pinned(*LIBRWGTA, os.path.join(work, 'src', 'librwgta'))
    os.makedirs(bindir, exist_ok=True)
    R, G = 'src/librw', 'src/librwgta'          # relative to `work`, keeps the command line short
    g = lambda pat: sorted(glob.glob(os.path.join(work, pat)))
    rel = lambda files: [os.path.relpath(f, work).replace('\\', '/') for f in files]
    lib = rel(g(f'{R}/src/*.cpp') + g(f'{R}/src/d3d/*.cpp') + g(f'{R}/src/gl/*.cpp') + g(f'{R}/src/ps2/*.cpp')
              + g(f'{R}/src/lodepng/lodepng.cpp') + g(f'{G}/src/*.cpp'))
    inc = [f'-I{R}', f'-I{R}/src', f'-I{G}/src']
    base = [gxx, '-std=c++17', '-O1', '-w', '-DRW_NULL'] + inc
    run(base + [f'-I{G}/tools/convdff'] + lib + [f'{G}/tools/convdff/{n}.cpp' for n in ('convdff', 'json', 'uv')]
        + ['-o', f'bin/convdff{EXE}'], cwd=work)
    run(base + lib + [f'{G}/tools/convtxd/convtxd.cpp', '-o', f'bin/convtxd{EXE}'], cwd=work)
    return convdff, convtxd


# ---- reading files out of the disc image ----------------------------------------------------------------------
class Disc:
    def __init__(self, path):
        self.iso = ISO(path)
        self.path = path

    def entry(self, p):
        return self.iso.find(p)

    def read(self, e, off=0, size=None):
        size = e['size'] - off if size is None else size
        self.iso.f.seek(e['lba'] * SECTOR + off)
        return self.iso.f.read(size)

    def file(self, p):
        return self.read(self.entry(p))


def img_index(disc, game):
    """name.lower() -> (byte offset, byte size) inside MODELS/GTA3.IMG (IMG v1 needs the .DIR file, v2 is self-contained)."""
    out = {}
    if game == 'sa':
        e = disc.entry('MODELS/GTA3.IMG')
        head = disc.read(e, 0, 8)
        assert head[:4] == b'VER2', 'San Andreas IMG should be version 2'
        n, = struct.unpack('<I', head[4:])
        d = disc.read(e, 8, n * 32)
        for i in range(n):
            off, sz = struct.unpack('<IH', d[i * 32:i * 32 + 6])
            out[d[i * 32 + 8:i * 32 + 32].split(b'\0')[0].decode('latin1').lower()] = (off * SECTOR, sz * SECTOR)
    else:
        d = disc.file('MODELS/GTA3.DIR')
        for i in range(0, len(d) - 31, 32):
            off, sz = struct.unpack('<II', d[i:i + 8])
            out[d[i + 8:i + 32].split(b'\0')[0].decode('latin1').lower()] = (off * SECTOR, sz * SECTOR)
    return out


def img_read(disc, idx, name):
    off, size = idx[name.lower()]
    return disc.read(disc.entry('MODELS/GTA3.IMG'), off, size)


# ---- per-model conversion ---------------------------------------------------------------------------------------
def convert(dff_bytes, txd_bytes, tag, work, outdir, base, tools, manifest):
    convdff, convtxd = tools
    wd = os.path.join(work, 'conv', tag)
    os.makedirs(wd, exist_ok=True)
    src_dff, src_txd, pc_dff = (os.path.join(wd, n) for n in ('in.dff', 'in.txd', 'out_pc.dff'))
    texdir = os.path.join(wd, 'tex')
    shutil.rmtree(texdir, ignore_errors=True)
    os.makedirs(texdir)
    open(src_dff, 'wb').write(dff_bytes)
    open(src_txd, 'wb').write(txd_bytes)
    run([convdff, '-u', '-o', 'd3d9', src_dff, pc_dff])      # PS2-native geometry -> plain RenderWare geometry
    run([convtxd, '-t', '-x', src_txd], cwd=texdir)           # unswizzle PS2 textures, write PNGs
    shutil.rmtree(outdir, ignore_errors=True)
    result, *_ = dff2obj.export(pc_dff, outdir, base, texdir)
    used = {m for r in result for m in r['mats'] if m}
    have = {f[:-4].lower(): f for f in os.listdir(texdir) if f.lower().endswith('.png')}
    missing = []
    for t in sorted(used):
        if t.lower() in have:
            shutil.copy(os.path.join(texdir, have[t.lower()]), os.path.join(outdir, t + '.png'))
        else:
            missing.append(t)
    manifest.append({'dir': os.path.relpath(outdir, ROOT).replace('\\', '/'), 'parts': result, 'missing_textures': missing,
                     'dff_sha256': hashlib.sha256(dff_bytes).hexdigest(), 'txd_sha256': hashlib.sha256(txd_bytes).hexdigest()})
    log(f'  {tag}: {len(result)} part(s), {len(used) - len(missing)} texture(s)' + (f', MISSING {missing}' if missing else ''))


def extract_img_game(game, iso_path, work, out, tools, extra, manifest):
    disc = Disc(iso_path)
    idx = img_index(disc, game)
    log(f'{game}: {iso_path} ({len(idx)} archive entries)')
    for w in IMG_WEAPONS[game] + [x for g, x in extra if g == game]:
        if w + '.dff' not in idx or w + '.txd' not in idx:
            log(f'  {game}/{w}: not in the archive, skipped')
            continue
        convert(img_read(disc, idx, w + '.dff'), img_read(disc, idx, w + '.txd'), f'{game}_{w}', work,
                os.path.join(out, game, 'obj_' + w), w, tools, manifest)


def extract_gta3(iso_path, work, out, tools, manifest):
    disc = Disc(iso_path)
    log(f'gta3: {iso_path}')
    # Every GTA III weapon is a frame of one DFF; the textures are in MISC.TXD.
    convert(disc.file('MODELS/GENERIC/WEAPONS.DFF'), disc.file('MODELS/MISC.TXD'), 'gta3_weapons', work,
            os.path.join(out, 'gta3', 'obj_weapons'), 'weapons', tools, manifest)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--gta3', help='GTA III (PS2) disc image')
    ap.add_argument('--vc', help='Vice City (PS2) disc image')
    ap.add_argument('--sa', help='San Andreas (PS2) disc image')
    ap.add_argument('--out', default=os.path.join(ROOT, 'models'))
    ap.add_argument('--work', default=os.path.join(ROOT, 'work'))
    ap.add_argument('--g++', dest='gxx', default='g++', help='C++ compiler used to build convdff/convtxd')
    ap.add_argument('--add', action='append', default=[], metavar='GAME:NAME',
                    help='also extract <NAME>.dff/.txd from the vc or sa archive, e.g. sa:chromegun (repeatable)')
    a = ap.parse_args()
    if not (a.gta3 or a.vc or a.sa):
        ap.error('give at least one disc image')
    extra = [tuple(x.split(':', 1)) for x in a.add]
    for g, _ in extra:
        if g not in IMG_WEAPONS:
            ap.error('--add only supports vc: and sa:')
    for p in (a.gta3, a.vc, a.sa):
        if p and not os.path.isfile(p):
            ap.error(f'not a file: {p}')
    if not shutil.which(a.gxx) and not (os.path.exists(os.path.join(a.work, 'bin', 'convdff' + EXE))):
        sys.exit(f'{a.gxx} not found. Install MinGW-w64 or MSYS2 (Windows) / build-essential (Linux) and put it on PATH.')
    os.makedirs(a.work, exist_ok=True)
    t0 = time.time()
    tools = build_tools(a.work, a.gxx)
    manifest = []
    if a.gta3:
        extract_gta3(a.gta3, a.work, a.out, tools, manifest)
    if a.vc:
        extract_img_game('vc', a.vc, a.work, a.out, tools, extra, manifest)
    if a.sa:
        extract_img_game('sa', a.sa, a.work, a.out, tools, extra, manifest)
    os.makedirs(a.out, exist_ok=True)
    json.dump({'models': manifest}, open(os.path.join(a.out, 'EXTRACTION.json'), 'w'), indent=1)
    log(f'done in {time.time() - t0:.0f}s: {len(manifest)} model folder(s) in {a.out}')


if __name__ == '__main__':
    main()
