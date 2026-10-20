"""Convert a NON-native (uninstanced) RenderWare DFF to OBJ+MTL (+ optional GLB).

usage: dff2obj.py in.dff outdir basename [texdir]   (texdir holds <texname>.png from convtxd -x)
Run with python -I. Pure stdlib. Handles RW 3.1-3.6 Geometry struct (no native data).
"""
import struct, sys, os, json, math

def chunks(d, o, end):
    while o + 12 <= end:
        t, s, v = struct.unpack_from('<III', d, o)
        yield t, o + 12, s, v
        o += 12 + s

def find(d, o, end, typ):
    return [(a, s) for t, a, s, v in chunks(d, o, end) if t == typ]

def read_str(d, o, s):
    return d[o:o + s].split(b'\0')[0].decode('latin1')

def parse_material(d, o, size):
    ch = list(chunks(d, o, o + size))
    st = ch[0]
    flags, = struct.unpack_from('<I', d, st[1])
    col = struct.unpack_from('<4B', d, st[1] + 4)
    textured, = struct.unpack_from('<I', d, st[1] + 12)
    tex = None
    for t, a, s, v in ch[1:]:
        if t == 6:
            strs = [read_str(d, a2, s2) for t2, a2, s2, v2 in chunks(d, a, a + s) if t2 == 2]
            tex = strs[0] if strs else None
    return dict(color=col, tex=tex)

def parse_geometry(d, o, size, ver=0xffffffff):
    ch = list(chunks(d, o, o + size))
    sp = ch[0][1]
    flags, ntri, nvert, nmorph = struct.unpack_from('<IIII', d, sp)
    if flags & 0x01000000:
        raise SystemExit('geometry is still PS2/native-instanced: run convdff -u first')
    p = sp + 16
    libver = ((ver >> 14) & 0x3ff00) + 0x30000 | ((ver >> 16) & 0x3f) if ver & 0xffff0000 else ver << 8 if ver < 0x1000 else ver
    if libver < 0x34000: p += 12   # ambient/diffuse/specular floats in old geometry struct
    ntex = (flags >> 16) & 0xff
    if ntex == 0:
        ntex = 2 if flags & 0x80 else (1 if flags & 4 else 0)
    cols = None
    if flags & 8:
        cols = [struct.unpack_from('<4B', d, p + i * 4) for i in range(nvert)]
        p += nvert * 4
    uvs = []
    for k in range(ntex):
        uvs.append([struct.unpack_from('<2f', d, p + i * 8) for i in range(nvert)])
        p += nvert * 8
    tris = []
    for i in range(ntri):
        v2, v1, m, v3 = struct.unpack_from('<4H', d, p + i * 8)
        tris.append((v1, v2, v3, m))
    p += ntri * 8
    verts = norms = None
    for mt in range(nmorph):
        sphere = struct.unpack_from('<4f', d, p); p += 16
        hv, hn = struct.unpack_from('<II', d, p); p += 8
        if hv:
            vv = [struct.unpack_from('<3f', d, p + i * 12) for i in range(nvert)]; p += nvert * 12
        if hn:
            nn = [struct.unpack_from('<3f', d, p + i * 12) for i in range(nvert)]; p += nvert * 12
        if mt == 0:
            verts = vv; norms = nn if hn else None
    mats = []
    for t, a, s, v in ch[1:]:
        if t == 8:
            for t2, a2, s2, v2 in chunks(d, a, a + s):
                if t2 == 7:
                    mats.append(parse_material(d, a2, s2))
    return dict(flags=flags, verts=verts, norms=norms, uvs=uvs, cols=cols, tris=tris, mats=mats)

def parse_dff(path):
    d = open(path, 'rb').read()
    t, a, s, v = next(chunks(d, 0, len(d)))
    assert t == 16, 'not a clump'
    frames = []; geoms = []; atomics = []
    for t, a2, s2, v2 in chunks(d, a, a + s):
        if t == 14:
            ch = list(chunks(d, a2, a2 + s2)); sp = ch[0][1]
            n, = struct.unpack_from('<I', d, sp)
            exts = [c for c in ch[1:] if c[0] == 3]
            for i in range(n):
                f = struct.unpack_from('<12f', d, sp + 4 + i * 56)
                par, fl = struct.unpack_from('<iI', d, sp + 4 + i * 56 + 48)
                name = ''
                if i < len(exts):
                    for t3, a3, s3, v3 in chunks(d, exts[i][1], exts[i][1] + exts[i][2]):
                        if t3 == 0x253f2fe: name = read_str(d, a3, s3)
                frames.append(dict(m=f, parent=par, name=name))
        elif t == 26:
            for t3, a3, s3, v3 in chunks(d, a2, a2 + s2):
                if t3 == 15: geoms.append(parse_geometry(d, a3, s3, v3))
        elif t == 20:
            sp = next(chunks(d, a2, a2 + s2))[1]
            fi, gi, fl, _ = struct.unpack_from('<4I', d, sp)
            atomics.append((fi, gi))
    return frames, geoms, atomics

def world(frames, i):
    m = frames[i]['m']; R = [m[0:3], m[3:6], m[6:9]]; pos = m[9:12]
    par = frames[i]['parent']
    if par < 0 or par == i:
        return R, pos
    PR, PP = world(frames, par)
    # row-vector convention: v' = v*R + pos; world = local then parent
    NR = [[sum(R[r][k] * PR[k][c] for k in range(3)) for c in range(3)] for r in range(3)]
    NP = [sum(pos[k] * PR[k][c] for k in range(3)) + PP[c] for c in range(3)]
    return NR, NP

def xf(v, R, P):
    return tuple(sum(v[k] * R[k][c] for k in range(3)) + P[c] for c in range(3))

def export(path, outdir, base, texdir=None):
    frames, geoms, atomics = parse_dff(path)
    os.makedirs(outdir, exist_ok=True)
    result = []
    for ai, (fi, gi) in enumerate(atomics):
        g = geoms[gi]; R, P = world(frames, fi) if frames else ([[1,0,0],[0,1,0],[0,0,1]], [0,0,0])
        name = f'{base}_{ai}_{frames[fi]["name"] or "atomic"}'
        V = [xf(v, R, P) for v in g['verts']]
        N = [xf(n, R, [0, 0, 0]) for n in g['norms']] if g['norms'] else None
        uv = g['uvs'][0] if g['uvs'] else None
        with open(os.path.join(outdir, name + '.mtl'), 'w') as f:
            for mi, m in enumerate(g['mats']):
                f.write(f'newmtl m{mi}\nKd {m["color"][0]/255:.3f} {m["color"][1]/255:.3f} {m["color"][2]/255:.3f}\n')
                if m['tex']: f.write(f'map_Kd {m["tex"]}.png\nmap_d {m["tex"]}.png\n')
        with open(os.path.join(outdir, name + '.obj'), 'w') as f:
            f.write(f'# {os.path.basename(path)} atomic {ai} frame {frames[fi]["name"]}\nmtllib {name}.mtl\n')
            for v in V: f.write('v %.6f %.6f %.6f\n' % v)
            if uv:
                for u in uv: f.write('vt %.6f %.6f\n' % (u[0], 1 - u[1]))
            if N:
                for n in N: f.write('vn %.6f %.6f %.6f\n' % n)
            cur = None
            for a, b, c, m in sorted(g['tris'], key=lambda t: t[3]):
                if m != cur: f.write(f'usemtl m{m}\n'); cur = m
                def ix(i):
                    i += 1
                    return f'{i}/{i if uv else ""}/{i if N else ""}'.replace('//', '//') if (uv or N) else str(i)
                f.write('f %s %s %s\n' % (ix(a), ix(b), ix(c)))
        result.append(dict(name=name, verts=len(V), tris=len(g['tris']), mats=[m['tex'] for m in g['mats']]))
    return result, frames, geoms, atomics

if __name__ == '__main__':
    r = export(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)[0]
    print(json.dumps(r, indent=1))
