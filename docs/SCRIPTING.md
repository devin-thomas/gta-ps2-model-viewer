# Scripting

Three ways in: a capture spec, a local HTTP port, and the in-page API.

## 1. Capture specs

`npx electron . --capture shots/tour.json --out out/tour.mp4 [--fps 60] [--crf 20]`

No window opens. Frames are rendered at exact scene times and piped to ffmpeg (x264, BT.709, yuv420p, faststart).

```json
{
  "name": "example", "width": 1920, "height": 1080, "fps": 120, "crf": 14,
  "spin": 0.45, "hideLabels": false,
  "segments": [
    { "t0": 0, "t1": 5, "type": "move", "ease": "smooth",
      "from": { "pos": [-6.5, 2.1, 1.5], "look": [4, 0.9, 1.5], "fov": 58 },
      "to":   { "pos": [-3.2, 1.6, 1.5], "look": [3, 1.1, 1.5], "fov": 52 },
      "caption": ["Title", "Subtitle"] },
    { "t0": 5, "t1": 9.5, "type": "orbit", "at": "sa/colt45",
      "radius": [1.7, 1.2], "height": [0.6, 0.45], "a0": 200, "a1": 100, "fov": 44 }
  ]
}
```

- `ease`: `smooth` (default), `linear`, `in`, `out`.
- A segment is `move` (`from`, `to`, each with `pos`, `look`, `fov`) or `orbit` (`at`, `radius`, `height`, `a0`, `a1` in degrees, `fov`; numbers or `[start, end]`).
- A point is `[x, y, z]` or `{"at": "<anchor>", "off": [x, y, z]}`. Anchors: a gun id such as `sa/colt45`, `col:<family>` (that weapon across games), `row:<game>` (`gta3`, `vc`, `sa`).
- `only: ["col:ak47"]` shows just those guns and pedestals for that segment.
- `caption: [title, subtitle]` fades in and out with the segment.
- `spin` is the gun rotation speed in rad/s; `duration` overrides the length (default: end of the last segment).
- World units are metres. Lanes sit at z = 0, 1.5, 3.0 (GTA III, Vice City, San Andreas); columns at x = 0, 1.5, 3.0 and so on.

Gun ids: `gta3/colt45 gta3/uzi gta3/shotgun gta3/m4 gta3/ak47 gta3/sniper gta3/rocket gta3/missile gta3/grenade gta3/molotov gta3/bomb gta3/flame gta3/bat vc/colt45 vc/ak47 vc/m4 sa/colt45 sa/deagle sa/ak47 sa/m4`.

## 2. Control port

`npx electron . --control-port 9120`

| Route | Result |
|---|---|
| `GET /state` | mode, scene time, fps stats, camera, gun list with positions and rotation offsets |
| `GET /screenshot` | PNG of the window |
| `POST /cmd` `{"name": ..., "args": {...}}` | run a command |
| `POST /quit` | close the app |

Commands: `setCamera {pos, look, fov}`, `tweenCamera {pos, look, fov, dur}`, `focus {id, dist, angle, h, instant}`, `setTime {t}`, `pause {on}`,
`setSpin {rad}`, `rotateGun {id, yaw, pitch}`, `caption {title, sub, hold}`, `hud {on}`, `render {t}`, `screenshot`, `only {list}`,
`list`, `pointer {type, x, y}` and `key {type, code}` (synthetic input), `screenPos {id}`.

The port listens on 127.0.0.1 only.

## 3. In page

`window.viewer.state()` and `window.viewer.cmd(name, args)`, for example from the DevTools console.
