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

## HCFR integration (patterns that follow your measurements)

HCFR (Colorimeter 3.5) can drive an external pattern generator. WinDAS Reborn pretends to be one (HCFR's built-in "Raspberry Pi" / PGenerator generator), so when HCFR asks for a 30 IRE gray, a 100% white, a 10% window or a primary colour, it appears on your CRT automatically, drawn exactly as requested.

1. Start the app with **WinDAS-Reborn.cmd**, go to **Patterns**.
2. Click **Enable HCFR link** (this also opens the pattern window; drag it onto the CRT and click it once for full screen).
3. With HCFR closed, click **Set HCFR to use this generator** (changes only HCFR's generator choice; your original settings are backed up, and **Undo HCFR setting** restores them).
4. Click **Launch HCFR**, then in HCFR use **File → New** and start a measurement. The app shows "HCFR asked for: …" live.

Only this machine can talk to the link (other computers are ignored), and it is off until you enable it. It needs the local launcher or the EXE; the online page cannot open ports.

HCFR sends the exact 0–255 codes (it already applies video/PC level scaling), which are shown on the pattern window unchanged. Stored image patterns that HCFR keeps on a real Pi (ramps etc.) are not available and are reported in the status line.

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

Working: ECS and ECS2 protocols (with the same Enter/Exit Factory handshake WinDAS uses), all 184 shipped models load, Factory Preset sliders, full register editor, simulator, pattern generator window, HCFR integration.
Not yet ported from the original: the `.prc` adjustment procedures (landing / convergence wizards), DCnv, Touch‑up, Failure, Maintenance (degauss / aging), Save/Load/MPU. Nothing has been verified against a real monitor yet.

## Legal

Independent, unofficial, not affiliated with Sony. Written for interoperability with hardware you own. MIT licensed (see LICENSE).
