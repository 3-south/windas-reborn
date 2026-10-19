# WinDAS protocol and file-format notes

Findings from analysing a user-owned copy of windas.exe for interoperability. Function names like FUN_0040dab2 are addresses in that binary (x86, image base 0x400000). No Sony code or data is included here.

## Architecture
- windas.exe: native x86 MFC42 C++ (NOT VB). 2571 functions. Document/view app.
- QDMGEN32.DLL: Quantum Data pattern generator (text cmds IMGL/FMTL/OUTG... over serial). Optional.
- TransDll/VTG32/VLIB32: video test generator hardware libs. Optional.
- Monitor link is in windas.exe itself (Win32 CreateFile/WriteFile/ReadFile).
- Settings in MFC profile (WriteProfileInt "WINDAS"): ECS_TYPE (1=ECS/.bus, 2=ECS2/.ec2), ECS_PORT (COM n), SG_*.

## Load chain
.mdl (model) -> chassis name at mdl+0x10 -> .chs -> std name -> .std -> bus/ec2 name -> command table.
Files in data\ ; procedures in WinDAS\<chassis>\*.prc.

## Serial transport
- COMn, 9600 baud, 8N1, RW, OPEN_EXISTING. Read timeout 3000 ms; 20000 ms when group flag == 6; 100 ms raw variant.
- One byte at a time; PurgeComm(3) before each send. Optional hex trace log ecs.log/ecs2.log.

## Command table file (.bus = ECS mode 1, .ec2 = ECS2 mode 2)
Sections in order, each: "====" + 4-char tag + int32 count + "====" (16 byte header), then count records:
- FOR : 0x98/rec. name[20]; int32 send[16] @0x14; int32 recv[16] @0x54; int32 flag @0x94.
- GRP : 0x20/rec. name[20]; byte flags @0x14 (bit2 = 16-bit reg); byte @0x15 (6 => slow, 20s timeout); byte @0x16 = arg2 for cmd; int32 max @0x18; int32 min @0x1c.
- R_B : 0x10/rec. byte count; name[11]; 4 bytes garbage. Register id = (block<<8)|idx ; abs = sum(count of blocks<block) + idx.
- REG : 0x24/rec. name[16]; write: cmd @0x10, address(arg1) @0x11, buffer offset @0x12; read: cmd @0x13;
        address(arg1) @0x14; buffer offset @0x15; int32 @0x20 = shadow of last raw read (runtime); byte group @0x19 (0=NON no-op); byte shift @0x1a; int32 mask @0x1c.

### Template tokens (int32)
<0x100 literal byte; 0x1000 = arg1; 0x4000 = arg2; 0x2000|n = n data bytes (ECS1: n NIBBLES, each data byte -> hi,lo bytes).
Terminator: ECS1 template ends 0xFF (0xFF byte appended on wire); ECS2 template ends 0x8000 and a checksum byte (sum of bytes &0xFF) is appended.
ECS2 packet: byte[1] = total length. ECS2 NAK: first byte 0x60, error code = byte[2]. Errors: 0x20000001 send/recv fail, 0x20000002 mismatch/checksum, 0x20000003 timeout.
ECS1 response: literals must match; nibble pairs combine (hi*16 + (lo&0xF)); ends 0xFF.
Read retries twice. Write flag bit0 = send now (else batched in buffer).

## .mdl layout (from loader FUN_0041f5ae)
16B header "====MDL=========", then base struct. Sections (marker 16B each): PRE_PARA (n x 0x50), ADJ_PARA (n x 0x50),
MPU_DATA (n x 0x200), MPU_MODE (n x 0x710), PRC_DATA (int + 0x1e0), TUP_DATA (int + 0x50 + 0x74), SPECIAL, AVPRE_PARA, UMT_NO.
## .chs : raw 0x974 bytes struct (no header). shorts at +2..+0x10 = 8 register ids for Factory Preset sliders.
## .std : 16B header "====STD=========" + 0x404c struct.

## UI (from resources): menu Setup(Model Sel F2, Config F3, Exit) / Adjustment(Fact_preset F5, Cont_SG F6, Maintenance, Touch up,
Procedure, DCnv, Failure) / File(Load, Save, MPU, UMT Init) / Help(Expert, Version).
Dialogs: Factory Preset (8 sliders), Control SG (patterns), Maintenance (Degauss/Aging/Power, Monitor ID, Factory ID), Procedure Select,
Step by Step, Expert (Viewer/Down timing/Timing edit/H+ H- V+ V- HP VP SYNC/Read/Write), DCnv adjustment point, Save/Load/Mpu/UMT.

## TODO
- mdl/chs/std field semantics, .prc format + runner, DCnv, touch up, failure, mdlsel.* obfuscation, VTG patterns.
