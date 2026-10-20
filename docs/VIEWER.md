# Viewer

`npm start`, or double-click `Gun Viewer.cmd`. Flags go after `--` with npm, or directly with `npx electron .`.

| Flag | Meaning |
|---|---|
| `--assets <dir>` | model folder (default `./models`, or set `GUN_ASSETS`) |
| `--width`, `--height` | window size |
| `--focus` | bring the window to the front (the one-click launcher uses this) |
| `--uncapped` | disable the frame limiter and vsync, for benchmarks |
| `--bench <seconds>` | run a frame-time benchmark and print JSON |
| `--target-fps <n>` | HUD target (default 120) |
| `--control-port <n>` | scripting port, see SCRIPTING.md |
| `--log <file>` | also write console output to a file |

## Layout

One lane per game (GTA III, Vice City, San Andreas) and one column per weapon family, ordered pistols, SMGs, shotgun,
rifles, then the rest. Guns are scaled to the same length (1.05 m). Row signs lie on the floor at the start of each lane.

## 120 Hz

The page paints at the display refresh rate, so 120 fps needs a monitor that runs at 120 Hz or more. The HUD shows fps,
frame time, 1% low and a bar against the 8.33 ms budget. Gun spin, momentum and camera glides use real elapsed time;
captures use explicit scene time instead, so they do not depend on frame pacing.

## Launching without taking focus

`launch.ps1` starts the app through `tools/noactivate.ps1` and the window opens with `showInactive()`, so a script never
takes keyboard focus. `Gun Viewer.cmd` passes `--focus` because you started it on purpose.

## Troubleshooting

- "No models found": run the extraction step, or pass `--assets`.
- Electron missing: run `npm install` (a `postinstall` step downloads the binary).
- A black window: check `--log out/run.log` for WebGL errors; a GPU with WebGL 2 is required.
