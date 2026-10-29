# Windows export workaround (installed builds)

Stop-gap for users on an installed Recordly build who hit either export problem
below on Windows with an AMD GPU. It patches `resources\app.asar` in place; the
source fix in `electron/ipc/export/native-video.ts` makes this unnecessary once
released.

| Symptom | Patch |
| --- | --- |
| Export hangs, screen flickers black, no file (`DXGI_ERROR_DEVICE_HUNG`) | `export-backend`: forces the native Breeze backend |
| Exported video loops earlier footage instead of advancing | `gpu-compositor-no-looping`: passes `--prefer-high-performance-adapter` to `recordly-gpu-export.exe` |

`recordly-export-patch-v2.ps1` applies both; `recordly-export-patch.ps1` is the
original backend-only version. Both need Node.js on PATH and `asar-pack.js` in
the same folder.

```powershell
# elevated PowerShell, Recordly fully closed
.\recordly-export-patch-v2.ps1 -Mode status
.\recordly-export-patch-v2.ps1 -Mode apply
.\recordly-export-patch-v2.ps1 -Mode revert   # restores the newest app.asar.*.bak
```

The default install path is `C:\Program Files\Recordly`; use `-AsarPath` for
another location. Each Recordly update reships the original `app.asar`, so
re-run `-Mode apply` after updating. Anchors are matched by content and the
script refuses to patch a build it does not recognise.
