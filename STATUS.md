# WinDAS Reborn — status and handoff

Last updated 2026-10-19 (v0.2.0).

## What it is
A modern, resizable replacement for the Sony **WinDAS** CRT service tool, plus an integration with **HCFR** (so HCFR's requested patterns appear on the CRT automatically). Plain JavaScript (ES modules), Web Serial, no build step. Repo: https://github.com/3-south/windas-reborn (public, MIT). Online: https://3-south.github.io/windas-reborn/ (no HCFR link there).

## How to run
- **Recommended:** Desktop shortcut "WinDAS Reborn" → `WinDAS-Reborn.cmd` (Node + Edge/Chrome `--app` window; server exits when the window closes). Works under Smart App Control (Node and Edge are signed).
- **EXE:** Releases → `WinDAS-Reborn-0.2.0.exe` (Electron, unsigned → Smart App Control may block it).
- **Dev:** `npm test` (node --test; needs the user's WinDAS folder via `WINDAS_DIR` or `Desktop\WINDAS`), `npm start`.

## Machine / environment facts
- User's data: `Desktop\WINDAS` (original, never modify), `Desktop\opendas` (an open-source WinDAS alternative; its docs independently confirm the protocol), HCFR 3.5.1.4 in `C:\Program Files (x86)\HCFR Calibration`.
- User's monitor: Dell P1130 = model list entry `P1130` → `9328.mdl` → chassis `CR1.chs` → `CR1.ec2` (ECS2 protocol).
- Windows Smart App Control is ON (blocks unsigned exes/DLLs). The earlier C# WPF attempt was abandoned for this reason (`~/Projects/windas-reborn`, local only, contains Ghidra decompiles of Sony code — never publish).
- Tools installed during the work: Java 21 (Temurin), Ghidra 12.1.4 (`~/tools`), .NET SDK 10, REA (`rea-agents`) MCP (needs `GHIDRA_INSTALL_DIR`/`JAVA_HOME` in the `rea` entry of `~/.claude.json`; restart Claude Code to load).

## Implemented
- ECS (`.bus`, nibble-expanded, `0xFF` terminated) and ECS2 (`.ec2`, length + checksum) packet executor; register bus (read/write, 16-bit, shift/mask, batching, shadow values); 9600 8N1 Web Serial; simulator.
- Model chain `mdlsel.ins` (nibble-swapped names, brand codes) → `.mdl` → `.chs` → `.std` → command table; all 184 models load.
- Session scripts: Enter/Exit Factory and key-lock steps from the chassis (ported from windas.exe).
- UI: Setup (brand filter, search), Factory Preset (8 chassis sliders), Registers (search any register, e.g. `G2`), Patterns, Wire log.
- Patterns: pop-up window for the CRT; WinDAS pattern set; exact IRE, window size, RGB channels, PC/video levels.
- HCFR link: PGenerator emulation (UDP 1977 discovery, TCP 85) + launch / configure / undo for HCFR; local-only, opt-in.
- Tests: 10 pass (tables, models, simulator round-trip, session scripts, PGenerator protocol incl. UDP+TCP session).

## Verified vs not verified
- Verified: parsers against all shipped files; simulator round-trips; HCFR's own `RB8PGenerator.dll` (run in 32-bit PowerShell) discovers, connects and gets patterns accepted; pattern pixels match requests exactly.
- NOT verified: anything on a real monitor; HCFR's GUI itself driving the link (needs File → New in HCFR); the EXE (CI builds it, never run locally).

## Not done (from the original WinDAS)
`.prc` adjustment procedures (landing/convergence wizards; format partly mapped in the C# repo notes), DCnv, Touch up, Failure, Maintenance (degauss/aging/power), Save/Load/MPU, UMT init, Control-SG hardware generators (not needed: the app is the generator).

## Open items for the user
- Try `Enable HCFR link` → `Set HCFR to use this generator` → `Launch HCFR` → Ctrl+N → measure.
- Free code signing: apply to https://signpath.org/foundation, then set repo variable `SIGNPATH_ORGANIZATION_ID` and secret `SIGNPATH_API_TOKEN` (workflow step already conditional).
- First hardware test: read in Factory Preset, watch the Wire log, change one value at a time. If the monitor's OSD stays locked, send Exit Factory (disconnect does it).

## Key reverse-engineering references
See [NOTES.md](NOTES.md): file formats, protocol, session scripts, and the HCFR generator protocol.
