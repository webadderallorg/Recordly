# Third-party notices

Desktop installers include this document, Recordly's license, dependency notices,
and the cursor source/license files in the application's `resources/licenses`
directory (`Recordly.app/Contents/Resources/licenses` on macOS). Each component
retains its own license; Recordly terms do not replace third-party permissions.

## OpenScreen

Recordly began as a fork of [OpenScreen](https://github.com/siddharthvaddem/openscreen).
The original OpenScreen code is provided under the following MIT license:

> MIT License
>
> Copyright (c) 2025 Siddharth Vaddem
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Voom

Recordly Share includes code adapted from the Voom project:

- Project: [Voom](https://github.com/aritropaul/voom)
- Adapted component: `services/recordly-share/worker`
- License: MIT
- Copyright © 2026 Aritro Paul
- Upstream reference: `c1c0350ed610b0c9bc4a307fcc6a01aab0f926f9`

Recordly changes include product branding, desktop publishing integration,
authenticated commenting, local-development configuration, and viewer styling.

The Voom software is provided under the following license:

> MIT License
>
> Copyright (c) 2026 Aritro Paul
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Solar Icons

Solar Icon Set by 480 Design, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Source: https://github.com/480-Design/Solar-Icon-Set. Icons are rendered using the MIT-licensed `@solar-icons/react` package. The muted microphone adds a diagonal stroke.

## DM Sans

Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts).

DM Sans is licensed under the SIL Open Font License, Version 1.1. The unmodified regular and italic variable fonts are sourced from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/dmsans). The full license is included in [src/assets/fonts/dm-sans/OFL.txt](src/assets/fonts/dm-sans/OFL.txt).

## Parakeet captions

Automatic captions use NVIDIA Parakeet TDT 0.6B v3, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Original model: [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3).
Recordly uses the [sherpa-onnx INT8 ONNX conversion](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8)
(revision `2bda32ec70b097a55adaa07d9a7173915b43cc78`), with model weights downloaded separately.
The conversion quantizes the model; Recordly does not train or modify its weights.

The local inference runtime [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
is licensed under Apache-2.0. Its native npm packages also include ONNX Runtime.
The runtime license and ONNX Runtime license/third-party notices are supplemented
from pinned upstream sources in [build/legal](build/legal/README.txt) and shipped
with the desktop notices. Installed package notices are collected at packaging time.

## Liquid Glass React

The wallpaper picker adapts the rounded-rectangle displacement and SVG refraction approach from
[rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react),
revision `ac48eab18d1f7f444ae30002d240cae29c863a21` (MIT, Copyright 2025 MAX ROVENSKY).
Recordly uses a single displacement pass and a precomputed map tailored to the thumbnail edges.
The full license is included in [src/assets/liquid-glass/LICENSE](src/assets/liquid-glass/LICENSE).


## Glass Icon Reveal

Recordly adapts the WebGL shader, signed distance field, and spring timeline from
[zanwei/glass-icon-reveal](https://github.com/zanwei/glass-icon-reveal) for its onboarding intro.

```text
MIT License

Copyright (c) 2026 Zanwei Guo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## TikTok Sans

Copyright 2024 TikTok Inc. (https://github.com/tiktok/TikTokSans). TikTok Sans is produced and maintained by
[TikTok](https://github.com/tiktok/TikTokSans) and licensed under the SIL Open Font License, Version 1.1.
Recordly bundles the unmodified variable TrueType font from the
[Google Fonts distribution](https://github.com/google/fonts/tree/2750b521bd22ce141f12617194ab0e04cf5d12d5/ofl/tiktoksans),
revision `2750b521bd22ce141f12617194ab0e04cf5d12d5`, for the TikTok caption preset.
The complete license and font provenance are included in
[src/assets/fonts/tiktok-sans/OFL.txt](src/assets/fonts/tiktok-sans/OFL.txt) and
[src/assets/fonts/tiktok-sans/README.md](src/assets/fonts/tiktok-sans/README.md).

## Community cursor themes

Recordly bundles adaptations of the following independently licensed cursor themes:

- **Bee:** [Bibata Bee Cursor](https://github.com/ful1e5/Bibata-Bee-Cursor),
  revision `2aa73cf4fe0ccffa9169e150c2018eb923badcbc`, by Kaiz Khatri, GPL-3.0.
  The stripe animation is frozen at its first frame for deterministic rendering.
- **BreezeX:** [BreezeX Cursor](https://github.com/ful1e5/BreezeX_Cursor),
  revision `5db7bc67873193b6fe837983c6401803df4f4408`, by Kaiz Khatri and based
  on KDE Breeze, GPL-3.0. The Dark palette is applied; closed-hand telemetry
  uses the move asset.
- **Catppuccin Pink:** [Catppuccin cursors](https://github.com/catppuccin/cursors),
  revision `a7eb08527dcce01010fa0ec46fa2bc4c3154f0d4`, GPL-2.0. Volantes shapes
  by Alexey Varfolomeev and Catppuccin contributors are colored with Mocha Pink.
  The theme's all-scroll asset represents closed-hand telemetry.
- **Pixel Glove:** [ComixCursors](https://github.com/lzlrd/comixcursors), revision
  `22deda869aab704329a7c534ea0d1087fbcb4563`, copyright Jens Luetkens and
  contributors, GPL-3.0-or-later. Recordly renders the glove shapes at 48 × 48,
  removes blurred shadows, and quantizes them to four greys with binary alpha.

Original licenses, authors, modification descriptions, and editable SVG sources
are preserved under [src/assets/cursors/community](src/assets/cursors/community/README.md)
and [src/assets/cursors/pixel-glove](src/assets/cursors/pixel-glove/README.md), and
are copied into the desktop distribution's `licenses/assets/cursors` directory.
The source and GPL permissions for these themes remain available independently
of any Recordly commercial licensing terms.

## FFmpeg and FFprobe

FFmpeg and FFprobe are separate multimedia executables. Their applicable license,
source/build provenance, and any source archives collected by the FFmpeg installer
are included in the desktop `licenses` directory. Packaging verifies FFmpeg's
distribution record and rejects nonredistributable builds. These components retain
their respective upstream licenses; see [FFmpeg licensing](https://ffmpeg.org/legal.html).

## Installed JavaScript and native package notices

The installer collects legal files and package license metadata for runtime
dependencies and packages imported by desktop source, including their installed
dependency trees. See `licenses/manifest.json` and `licenses/npm` in the installed
application. The inventory also identifies packages that provide metadata or a
README without a separate license file; it is not a substitute for reviewing
the actual bundled native libraries or satisfying corresponding-source obligations.
