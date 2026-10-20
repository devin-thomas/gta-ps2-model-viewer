"""Dump RenderWare chunk tree. rwtree.py file [maxdepth]"""
import struct, sys
NAMES={1:'Struct',2:'String',3:'Extension',5:'Camera',6:'Texture',7:'Material',8:'MaterialList',9:'AtomicSect',10:'PlaneSect',11:'World',12:'Spline',13:'Matrix',14:'FrameList',15:'Geometry',16:'Clump',18:'Light',19:'UnicodeString',20:'Atomic',21:'TextureNative',22:'TexDict',23:'AnimDB',24:'Image',25:'SkinAnimation',26:'GeometryList',27:'AnimAnimation',28:'HAnim',29:'TeamID',30:'Bitmap',
0x116:'Skin',0x11e:'HAnimPLG',0x50e:'BinMesh',0x510:'NativeData',0x253f2f3:'PipelineSet',0x253f2f6:'SpecularMat',0x253f2f8:'2dfx',0x253f2f9:'NightVertexColor',0x253f2fa:'CollisionModel',0x253f2fc:'ReflectionMat',0x253f2fd:'MeshExt',0x253f2fe:'FrameName'}
def walk(d, o, end, depth, maxd, ind=''):
    while o+12 <= end:
        t,s,v = struct.unpack('<III', d[o:o+12])
        print(f'{ind}{NAMES.get(t,hex(t))} size={s} ver={v:#x} @{o}')
        if depth<maxd and t in (16,15,26,3,7,8,6,20,14,22,21) and s:
            if t!=21: walk(d, o+12, o+12+s, depth+1, maxd, ind+'  ')
            else: walk(d, o+12, o+12+s, depth+1, maxd, ind+'  ')
        o += 12+s
if __name__=='__main__':
    d=open(sys.argv[1],'rb').read(); walk(d,0,len(d),0,int(sys.argv[2]) if len(sys.argv)>2 else 6)
