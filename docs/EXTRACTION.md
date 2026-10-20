# Extraction

`python tools/extract.py --gta3 <iso> --vc <iso> --sa <iso> [--out models] [--work work] [--add sa:chromegun]`

The disc images are opened read-only. Nothing is written to them and nothing is mounted.

## Steps

1. **Read the ISO.** The PS2 discs are plain ISO 9660. `tools/iso9660.py` is a small reader, so no 7-Zip or mounting is needed.
2. **Find the weapon files.**
   - GTA III: `MODELS/GENERIC/WEAPONS.DFF` holds every weapon as a frame of one model; the textures are in `MODELS/MISC.TXD`.
   - Vice City: `MODELS/GTA3.IMG` with `MODELS/GTA3.DIR` (IMG version 1). Each weapon is `<name>.dff` and `<name>.txd`.
   - San Andreas: `MODELS/GTA3.IMG` (IMG version 2, a single file). Same `<name>.dff` / `<name>.txd` layout.
   - The discs also carry `GTA3_1.IMG` and similar copies, which are only a seek-time layout trick. They are not needed.
3. **Convert the geometry.** San Andreas and Vice City store PS2-native, pre-instanced geometry (RenderWare chunk `NativeData`).
   `convdff -u -o d3d9` from aap/librwgta turns it into plain RenderWare geometry. GTA III's weapons are already plain.
4. **Convert the textures.** `convtxd -t -x` unswizzles the PS2 GS textures and writes PNGs.
5. **Write OBJ.** `tools/dff2obj.py` reads the plain DFF (frame transforms included) and writes one OBJ + MTL per atomic.
   Muzzle flashes come out as separate `gunflash` parts; the viewer skips them.

## Output

```
models/gta3/obj_weapons/weapons_10_colt45_l0.obj   (+ .mtl, textures)
models/vc/obj_colt45/colt45_0_colt45.obj
models/sa/obj_desert_eagle/desert_eagle_0_desert_eagle.obj
models/EXTRACTION.json                              SHA-256 of every source DFF/TXD
```

## Orientation

RenderWare is Z-up. San Andreas and Vice City guns point along +X; GTA III's weapon frames point along +Y. The viewer
rotates every model upright and turns GTA III's by a further quarter turn so all guns point the same way.

## Prerequisites and failure modes

- `g++` must be on `PATH` for the first run (or pass `--g++ <path>`). The build uses no CMake or premake.
- `git` is used to fetch two pinned commits of aap/librw and aap/librwgta.
- If a weapon is missing you get a "not in the archive" line and the rest continues. Only the disc versions listed in the README are tested.
- The extraction was checked by hash against an earlier hand-run of the same pipeline: all OBJ bodies, MTL and PNG files matched.

## Prior work

The formats and tools are community work: aap's librw/librwgta (PS2 uninstancing and texture decoding), the
[GTAMods wiki](https://gtamods.com/wiki/RenderWare) for the RenderWare and IMG formats, DragonFF and Magic.TXD for the same job with a GUI.
What this repository adds is a scripted, GUI-free path from the disc to the viewer.
