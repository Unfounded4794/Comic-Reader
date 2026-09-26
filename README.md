# Panel Reader

A standalone, offline comic reader for Windows and Linux (including CachyOS). No account, comic server, Python installation, GPU, or separate UnRAR installation is required by the packaged app.

## Run the packaged app

**Windows x64:** run `Panel-Reader-0.1.0-Windows-x64.exe`. This is a portable launcher: it extracts the bundled application temporarily and keeps your library/settings under `%APPDATA%/Panel Reader`. The build is unsigned.

**CachyOS / Linux x64:** extract `Panel-Reader-0.1.0-Linux-x64.tar.gz`, open the extracted folder, and run `./panel-reader`. Executable permissions are included and verified in the archive. If your extraction tool discards them, run `chmod +x panel-reader chrome-sandbox chrome_crashpad_handler`. A normal graphical desktop with glibc, GTK 3, NSS, ALSA and GBM is needed; these are normally present on a desktop CachyOS installation. The tar distribution does not need FUSE. Linux packages are cross-built; this development machine has not run the application on CachyOS.

On Linux, preferences and cached panel layouts live in `~/.config/Panel Reader`. `PANEL_READER_DATA` can override the data directory, useful for tests or a portable profile. The comics themselves stay wherever you selected them.

## Read

1. **Add folder** scans recursively for CBZ/CBR/ZIP/RAR archives. **Rescan folders** or F5 discovers new issues; scans also run every five minutes by default. Unavailable files keep their reading history. Newly discovered books have a NEW badge.
2. **Open comic** accepts individual archives. You can also drop archives into the window. **Image folder** opens a folder of individual page images in natural filename order.
3. Click a cover to read. Left/Right go backward/forward. **Up/Down scroll within the current page** using your configured pixel distance. Drag a page to pan.
4. The toolbar has fit-page, fit-width and fit-height buttons, guided panels, webtoon mode, panel editing, preferences and fullscreen. The footer shows page/panel counts and zoom controls.
5. F11 enters fullscreen and hides **all** controls, counters, scrollbars and notifications. Move the pointer without exposing overlays. Tab explicitly reveals/hides controls; Escape exits fullscreen. These shortcuts can be changed too.

## Default shortcuts

| Function | Default |
| --- | --- |
| Open archive / add library folder / open image folder | Ctrl+O / Ctrl+Shift+O / Ctrl+Alt+O |
| Next / previous page or panel | Right / Left |
| Next / previous whole page | PageDown / PageUp |
| Scroll down / up inside page | Down / Up |
| Horizontal scroll | Shift+Left / Shift+Right |
| Fit page / width / height | F / W / H |
| Zoom in / out / actual size | = / − / 0 |
| Guided panels / webtoon mode | P / T |
| Edit panels / detect again | E / Ctrl+R |
| Go to page / first / last | G / Home / End |
| Fullscreen / show controls | F11 / Tab |
| Library / preferences / background | L / Ctrl+, / B |
| Next / previous comic | Ctrl+Right / Ctrl+Left |

**Preferences → Shortcuts** lists all 48 commands. Click a binding and press a new combination. Conflicts are reported; bindings can be cleared. Shortcuts use physical key codes so the same binding is stable across keyboard layouts. OS-reserved combinations remain subject to the desktop environment.

## Guided panels

The local pipeline combines an Inkwell YOLOv8 detector trained on Western comics at two resolutions, Poneglyph YOLO11 instance-mask outlines, and the Inkwell learned pairwise reading-order model. It does not depend on white gutters or rectangular panel separators. Inset panels are kept separate rather than eliminated by containment-based suppression. Outline polygons can be nonrectangular and concave. Full-page fallbacks retain splash artwork. Long pages are analyzed using overlapping tiles.

The reader centers and scales the active panel, dims the surroundings, and changes **Next** to advance through the panels before advancing the page. Adjust confidence, surrounding dimness and padding in preferences. Left-to-right and right-to-left ordering are available.

**Detection is useful, but not perfect.** Overlapping artwork, narrative layouts, ads and some angled panels can still produce missed, extra or incorrectly ordered panels. The source models' published accuracy is not a measured accuracy guarantee for this application. Inspect `docs/VALIDATION.md` for what was actually tested.

Press E to correct any page: select outlines, remove incorrect panels, draw rectangles or arbitrary polygons, and move panels earlier/later. For polygon drawing, click each corner and click Finish (Enter). Ctrl+S saves. Corrections persist independently of automatic detector settings. Ctrl+R can explicitly replace a saved layout after confirmation. Source archives are never modified.

## Webtoons

Continuous mode stacks images without gaps by default. Set the column width and image gap in preferences. It accepts ordinary multi-image archives, image folders, and stitched tall images. Images taller than 4,096 pixels are served as strips; pages far from the viewport are unloaded. Up/Down scroll normally, while Next/Previous jump to the next/previous image. There is no automatic panel stepping in webtoon mode; switch to Guided panels for that.

## Development and builds

Node.js 22.22 or later and npm are required only for building from source.

```sh
npm ci
npm run models       # downloads and verifies three pinned ONNX models (~25 MB)
npm start            # builds the UI and runs the desktop app
npm run dev          # Vite UI with the Electron shell
npm test
npm run pack:win     # build on Windows
npm run pack:linux   # AppImage + tar.gz on Linux
```

Use `npm run pack:linux:tar` for a tar-only build. Cross-building from Windows requires the target-platform sharp packages: `npm install --no-save --force @img/sharp-linux-x64@0.35.4 @img/sharp-libvips-linux-x64@1.3.3`. Native ONNX Runtime binaries for both targets ship with its npm package. Build tools and model downloads need network access; the finished reader does not.

`npm run test:samples` fully decodes and detects each page in four local sample archives and produces diagnostic overlays. Provide a JSON array of four absolute archive paths through `PANEL_READER_SAMPLES`, or save it to the ignored `validation/sample-paths.json`. `npm run test:desktop` drives the built Electron app with temporary settings and synthetic fixtures plus those sample archives. `npm run pack:source` creates a source ZIP, including model weights and licenses, excluding comics, test outputs and personal paths.

## Practical limits

- Password-protected archives, multipart RARs, and RAR files above 1.5 GB are not supported. Individual compressed image entries are limited to 256 MB and decoded images to 400 megapixels.
- JPEG, PNG, WebP, AVIF, GIF and TIFF page files are recognized. Animated images are treated as static pages; TIFF/GIF are normalized for display.
- First-page cover thumbnails and panel results are cached locally. Automatic detections invalidate when archive size or modification time changes. Caches currently have no automatic disk eviction; the in-memory compressed-image cache is limited to 128 MB.
- Library scans ignore symlinks to avoid cycles. Image folders read immediate child images; library archive scanning includes subfolders.
- The local build is unsigned. No publishing, installer registration, file associations or system-wide changes are performed.

The application is AGPL-3.0-only because the bundled detector models carry AGPL requirements. See `THIRD_PARTY_NOTICES.md` and `models/manifest.json` for provenance and checksums.
