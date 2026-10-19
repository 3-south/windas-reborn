# WinDAS Reborn

A modern, resizable replacement front end for the Sony **WinDAS** service tool used to adjust Sony Trinitron CRT monitors (geometry, white balance / G2, convergence registers…) over a TTL‑serial adapter.

It speaks the same serial protocol as the original, reverse‑engineered from your own copy of WinDAS, and reads **your own WinDAS data files** (`mdlsel.ins` and the `data` folder) locally in the browser. **No Sony files are included in this repository and nothing is uploaded.**

> ⚠️ This writes to a monitor's service registers. Wrong values can leave a CRT mis‑adjusted. Read first, change one thing at a time, and use *Restore*. Use at your own risk.

## Run it on your PC (recommended)

Double-click **WinDAS-Reborn.cmd** (needs Node.js and Edge or Chrome). It starts a tiny local server and opens the app in its own window; closing the window stops the server. No signing needed, so Smart App Control does not interfere.

## Use it online (no install)

1. Open **https://3-south.github.io/windas-reborn/** in **Microsoft Edge or Google Chrome** (Web Serial is Chromium‑only).
2. **Setup → Choose WinDAS folder** – pick the original `WINDAS` folder (the one with `windas.exe` and `data\`).
3. Pick your monitor model, then **Connect serial adapter…** (or **Use simulator** to practise).
4. **Factory Preset** for the chassis' main adjustments, **Registers** to read/write any register (search `G2`), **Wire log** to see every byte.

Wiring: adapter TXD → monitor RXD, adapter RXD → monitor TXD, GND → GND (5 V not needed). 9600 baud, 8N1.

## Windows EXE

Releases contain a portable `.exe` (the same app in an Electron window). 

**Code signing.** Windows *Smart App Control* blocks unsigned programs, and self‑signed certificates don't help. The web version above has nothing to sign and works regardless. For a signed EXE, the free route is the [SignPath Foundation](https://signpath.org/foundation) (open‑source projects): apply with this repo, then set the repo variable `SIGNPATH_ORGANIZATION_ID` and secret `SIGNPATH_API_TOKEN`; the release workflow signs automatically. Until then the EXE is unsigned.

## Develop

```
npm test                 # node --test; set WINDAS_DIR to your WinDAS folder (tests skip without it)
npm start                # static server on :8080 (set WINDAS_DIR to expose your folder at /__windas/ for ?dev=1 testing)
npm run dist             # build the EXE locally (needs Windows)
```

See [NOTES.md](NOTES.md) for the reverse‑engineered file formats and protocol.

## Status

Working: ECS and ECS2 protocols, all 184 shipped models load, Factory Preset sliders, full register editor, simulator.
Not yet ported from the original: the `.prc` adjustment procedures (landing / convergence wizards), DCnv, Touch‑up, Failure, Maintenance (degauss / aging), Save/Load/MPU. Nothing has been verified against a real monitor yet.

## Legal

Independent, unofficial, not affiliated with Sony. Written for interoperability with hardware you own. MIT licensed (see LICENSE).
