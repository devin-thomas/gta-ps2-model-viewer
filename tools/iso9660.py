"""Minimal read-only ISO9660 reader. Usage:
  iso9660.py ls ISO [path]            list directory (recursive with -r)
  iso9660.py get ISO isopath outfile  extract one file (read-only on ISO)
"""
import struct, sys, hashlib

class ISO:
    def __init__(self, path):
        self.f = open(path, 'rb')
        self.f.seek(16*2048)
        pvd = self.f.read(2048)
        assert pvd[1:6] == b'CD001', 'no PVD'
        self.root = self._rec(pvd[156:190])
    def _rec(self, b):
        lba, = struct.unpack('<I', b[2:6]); size, = struct.unpack('<I', b[10:14])
        flags = b[25]; n = b[32]; name = b[33:33+n].decode('latin1')
        return dict(lba=lba, size=size, dir=bool(flags & 2), name=name)
    def readdir(self, d):
        self.f.seek(d['lba']*2048); data = self.f.read(d['size']); out = []; i = 0
        while i < len(data):
            l = data[i]
            if l == 0:
                i = (i//2048+1)*2048; continue
            r = self._rec(data[i:i+l]); i += l
            if r['name'] in ('\x00', '\x01'): continue
            r['name'] = r['name'].split(';')[0]
            out.append(r)
        return out
    def find(self, path):
        d = self.root
        for part in [p for p in path.replace(chr(92),'/').split('/') if p]:
            for e in self.readdir(d):
                if e['name'].upper() == part.upper(): d = e; break
            else: raise FileNotFoundError(path)
        return d
    def walk(self, d, prefix=''):
        for e in self.readdir(d):
            yield prefix + e['name'], e
            if e['dir']: yield from self.walk(e, prefix + e['name'] + '/')
    def read(self, e, out):
        self.f.seek(e['lba']*2048); left = e['size']; h = hashlib.sha256()
        with open(out, 'wb') as o:
            while left:
                b = self.f.read(min(left, 1<<22)); o.write(b); h.update(b); left -= len(b)
        return h.hexdigest()

if __name__ == '__main__':
    iso = ISO(sys.argv[2])
    if sys.argv[1] == 'ls':
        for p, e in iso.walk(iso.root): print(('D ' if e['dir'] else 'F ') + p, e['size'])
    elif sys.argv[1] == 'get':
        e = iso.find(sys.argv[3]); print(e['size'], iso.read(e, sys.argv[4]))
