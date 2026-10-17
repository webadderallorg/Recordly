# Golden Gate cursor artwork

The three hand cursors are vector conversions of the macOS 27.2 system PDFs under
`ApplicationServices.framework/Frameworks/HIServices.framework/Resources/cursors/macos27`.
Converted with Poppler `pdftocairo -svg`; the 32-by-32 canvas is preserved.
Hotspots come from each cursor's accompanying `info.plist`:

| Cursor | Hotspot (points) |
| --- | --- |
| Pointing hand | 12, 8 |
| Open hand | 15, 16 |
| Closed hand | 15, 16 |

Golden Gate overrides these three cursors. Other states use the existing Tahoe
artwork. The stored `tahoe` and `tahoe-inverted` style IDs remain compatible with
saved projects; the editor displays Golden Gate and Golden Gate Inverted.
