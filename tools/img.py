"""IMG v1 (DIR+IMG) / v2 (VER2) lister+extractor. img.py ls v1 DIR IMG | ls v2 IMG | get v1 DIR IMG name out | get v2 IMG name out"""
import struct, sys, re
def entries(mode, dirp, imgp=None):
    out = []
    if mode == 'v1':
        d = open(dirp,'rb').read()
        for i in range(0, len(d), 32):
            off, sz = struct.unpack('<II', d[i:i+8]); n = d[i+8:i+32].split(b'\0')[0].decode('latin1')
            out.append((n, off*2048, sz*2048))
    else:
        f = open(dirp,'rb'); h = f.read(8); assert h[:4]==b'VER2'; n, = struct.unpack('<I', h[4:])
        d = f.read(n*32)
        for i in range(n):
            off, sz1, sz2 = struct.unpack('<IHH', d[i*32:i*32+8]); nm = d[i*32+8:i*32+32].split(b'\0')[0].decode('latin1')
            out.append((nm, off*2048, sz1*2048))
    return out
def main():
    a = sys.argv
    if a[1]=='ls':
        mode=a[2]; es = entries(mode, a[3]); pat = re.compile(a[-1] if len(a)>(4 if mode=='v2' else 5) else '.')
        for n,o,s in es:
            if pat.search(n): print(n,o,s)
    else:
        mode=a[2]
        if mode=='v1': dirp,imgp,name,out=a[3:7]
        else: dirp,name,out=a[3:6]; imgp=dirp
        for n,o,s in entries(mode,dirp):
            if n.lower()==name.lower():
                with open(imgp,'rb') as f: f.seek(o); data=f.read(s)
                open(out,'wb').write(data); print(n,o,s); return
        sys.exit('not found')
main()
