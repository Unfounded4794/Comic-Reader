# Panel Reader

A standalone, offline comic reader for Windows and Linux (including CachyOS), with an Apple Silicon macOS build target. No account, comic server, Python installation, GPU, or separate UnRAR installation is required by the packaged app.

## Run the packaged app

**Windows x64:** use `Panel-Reader-0.3.9-Windows-x64-Setup.exe` for an installed app with a stable Start menu shortcut that can be pinned to the taskbar. Alternatively run `Panel-Reader-0.3.9-Windows-x64.exe`, a portable launcher that temporarily extracts the bundled application. Both keep your library/settings under `%APPDATA%/Panel Reader`. The builds are unsigned. If a pin from an older portable release does not work, unpin it and pin the installed Start menu shortcut. Portable releases now set their taskbar identity and relaunch target to the outer EXE; keep that EXE at the same path for the pin to work.

**CachyOS / Linux x64:** extract `Panel-Reader-0.3.9-Linux-x64.tar.gz`, open the extracted folder, and run `./panel-reader`. Executable permissions are included and verified in the archive. If your extraction tool discards them, run `chmod +x panel-reader chrome-sandbox chrome_crashpad_handler`. A normal graphical desktop with glibc, GTK 3, NSS, ALSA and GBM is needed; these are normally present on a desktop CachyOS installation. The tar distribution does not need FUSE. Release packages are built and tested on a native Linux runner; this development machine has not run the application on CachyOS.

**Apple Silicon macOS:** extract `Panel-Reader-0.3.9-macOS-arm64.zip` and open Panel Reader.app. The macOS target is configured for native ARM64 Electron, Sharp, and ONNX Runtime binaries. It uses an ad hoc signature for a local build and is not notarized. The release workflow has built the package and passed the desktop feature suite on a native Apple Silicon runner. This Windows machine cannot produce a macOS package with electron-builder.

On Linux, preferences and cached panel layouts live in `~/.config/Panel Reader`. `PANEL_READER_DATA` can override the data directory, useful for tests or a portable profile. The comics themselves stay wherever you selected them.

## Read

1. **Add folder** scans recursively for CBZ/CBR/ZIP/RAR archives. Home displays each watched root’s immediate child folders. Roots without child folders remain visible, including empty sources; comics stored directly beside child folders stay accessible in Home. Its count matches the displayed folders and loose comics. Opening a collection shows only its immediate subfolders and comics stored directly in it; continue down to a series folder to see that series’ issues. The sidebar lists only watched library roots, while child folders stay in the main browser. Hover a watched root to change its location or remove it. **Rescan folders** or F5 discovers new issues. Discoveries appear in batches while scanning continues, with a folder/comic count, progress bar, and **Cancel scan**. Discovered comics can be opened immediately; cancelling preserves discovered books and the unvisited portion of the existing library. Metadata requests use bounded parallelism; scans also run every five minutes by default. Unavailable files keep their reading history. Newly discovered books have a NEW badge.
2. **Open comic / image** accepts individual archives and standalone JPG, PNG, WebP, AVIF, GIF or TIFF images. Files can also be dropped into the window. Tall standalone images automatically open in continuous webtoon mode. **Image folder** opens a folder of individual page images in natural filename order.
3. Click a cover to read. Left/Right go backward/forward. **Up/Down scroll within the current page** using your configured pixel distance. Drag a page to pan.
4. The toolbar has fit-page, fit-width and fit-height buttons, guided panels, webtoon mode, manga direction, panel editing, preferences and fullscreen. Guided mode always contains the complete active panel, independent of the page fit setting. Manga direction orders detected panels right-to-left and makes Left advance through panels and pages. The footer shows page/panel counts and zoom controls.
5. F11 enters fullscreen and hides controls, counters, scrollbars and ordinary notifications. Saving a page still displays its destination confirmation. Move the pointer without exposing overlays. Tab explicitly reveals/hides controls; Escape exits fullscreen. These shortcuts can be changed too.

Home has a **Continue reading** shelf for up to ten recently active series, resuming unfinished issues or offering the next unread issue. Folder cards sit beneath the Home tab. Arrow keys move along visible rows and columns; Right from the sidebar enters the collection, and Enter opens the selected item. It never dumps every scanned issue into one grid. The History view lists opened comics by most recent reading time. Newly Added and global search can deliberately show results across folders. Next/previous comic follows natural filename order within the current folder, so issue 36 follows issue 35. Enable **Preferences → Library → Continue between comics** to cross either boundary: Next after the last page starts the next comic; Previous before the first page opens the previous comic’s final page (and final panel in guided mode).

## Share reading progress between devices

In **Preferences → Library → Share reading progress**, choose the same writable network folder on each device. Comics may be local copies or live directly on a network drive. Their names, enclosing folders, drive letters, and mount paths can differ: the app uses path-independent content identifiers. ZIP/CBZ identifiers hash the archive index, including every entry’s name, checksum, sizes, compression method, and offset; this avoids downloading entire volumes just to identify them. Other files and image folders retain byte-based identifiers. Existing whole-file identifiers are linked to the new index identifiers when unchanged known archives are upgraded. Existing local bookmarks seed the shared history automatically. Library scans only discover files and read metadata. ZIP/CBZ matching uses cached directory blocks; background matching pauses while reading, and opening a comic does not wait for a shared-progress exchange. RAR identification reuses bytes already loaded to open the archive. Repacked or edited archives may have different identifiers.

Bookmarks, last-read history, and completion are shared; display preferences, favorites, panel corrections, and image/model caches stay on each device. Finished comics have grayscale covers and a **Read** checkmark; hover or focus restores the cover's colors. Page mode finishes on the final page, guided mode on the final panel of that page, and continuous mode when the viewport reaches the bottom. Revisiting a finished comic preserves its read status. Hover or focus its top-left **Read** badge to reveal **Mark unread**. Clicking clears completion and the bookmark, restores the cover colors, and shares the reset across devices. An unfinished comic offers **Mark read** in the same corner on hover or focus; this marks the actual final page without opening the reader. Both actions synchronize with other devices. Continue reading offers unfinished issues or the next issue that has not been completed.

Each installation writes its own versioned snapshot inside `.panel-reader-progress` in the selected shared folder. These files contain content fingerprints, positions, completion, timestamps, and random installation identifiers; they do not contain comic files, local paths, account details, or telemetry. Anyone with access to that folder can access its reading records. No account or separate service is required. Leave the local app-data directory on each device; only the selected progress folder is shared.

The app checks for updates every ten seconds, when focused, and in the background when opening a comic. **Upload progress**, shown below the sidebar folder list when a shared progress folder is selected, saves the current bookmark and immediately forces an upload and download; it reports success or an unavailable share. Automatic exchanges read only changed device snapshots and skip unchanged uploads. Received bookmarks update the library without moving an active reader; a small notice offers the saved position. Only changes to reading positions create new records, so an idle device closing cannot replace another device's progress. If devices read independently, both bookmarks survive until you choose a position on the next open. Changes to different comics merge automatically, and normal handoffs use the order of changes rather than device clocks. Unavailable or unwritable shared storage leaves a durable local bookmark and retries when the app next connects. **Stop sharing** keeps existing local and shared history. Snapshot uploads are flushed before atomic replacement. Failed device-file reads retry once and identify the filename and reason instead of assuming every failure is corruption; other devices’ unreadable files are preserved. A damaged or missing shared snapshot owned by this installation is recreated from its local outbox.

The current implementation is for the desktop app. Its versioned, path-independent records can be reused by a future tablet app, which will also need a supported way to exchange them. The desktop integration suite uses isolated local folders to simulate two installations and an unavailable drive; actual SMB/NAS permissions and disconnect behavior need testing on your own network.

Run `npm run test:progress` to exercise local-copy/shared-library handoffs, conflicting bookmarks, idle shutdown, completion in all three reading modes, reconnects, renamed files, Mark unread, and manual progress updates with two isolated Electron profiles. `npm run test:network` tests partial discovery, reading during a deliberately stalled scan, cancellation, and GUI cleanup. Unit tests measure bounded ZIP-directory reads, bounded scan concurrency, and cache reuse after source disconnection.

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
| Save original page | Ctrl+Shift+S |
| Favorite / unfavorite issue | Ctrl+D |

**Preferences → Shortcuts** lists all 50 commands. Click a binding and press a new combination. Conflicts are reported; bindings can be cleared. Shortcuts use physical key codes so the same binding is stable across keyboard layouts. OS-reserved combinations remain subject to the desktop environment.

## Save pages and favorites

Choose **Preferences → Reading → Saved pages → Choose saved pages folder** once, then press **Ctrl+Shift+S** or the save button while reading. The original image entry is copied into a subfolder named after the comic, preserving its filename, format and bytes. Guided mode saves the complete page, and a tiled long webtoon saves its complete original image. In continuous mode, the page at the top of the viewport is saved. Repeating a save skips an identical file; different files with the same name get a numbered suffix. The archive stays unchanged. Save confirmations remain visible in clean fullscreen; click the destination path to reveal the saved file. Right-click a comic and choose **Open file location** to reveal its source.

Press **Ctrl+D** while reading, click the star on a cover, or focus a comic and use the shortcut to toggle its favorite status. **Favorites** sits below History and lists starred issues across your library. Favorites persist through app restarts and rescans. Both shortcuts are configurable.

## Guided panels

The local pipeline combines an Inkwell YOLOv8 detector at two resolutions, a Poneglyph panel-shape model, a Poneglyph speech-bubble detector, and the Inkwell learned reading-order model. Native-scale detections anchor the layout. Additional candidates must provide independent evidence: nested clocks, captions, and comic covers pictured inside artwork are rejected, while confident inset panels remain. Inconsistent model bounds cannot merge neighbouring panels. Automatic frames use complete rectangular bounds because segmentation masks can follow character silhouettes and omit backgrounds; manually drawn polygons still retain their exact outlines.

Coverage measures the union of the actual visible regions. Missing artwork is recovered locally, clipped neighbours expand, and narrow gutters and outside margins join their adjacent frames. The recovery target is 90% page coverage and 97% artwork coverage; this is a heuristic, not a guarantee for every comic. No full-page overview is added before close-ups. A single whole-page stop is used for illustrations or when there is insufficient evidence to identify panels. Recognized speech bubbles are assigned to the panel containing the largest share, with insets breaking ties, and remain inside both the camera frame and reveal mask. Long pages apply the pipeline to overlapping tiles. Automatic cached layouts refresh for this detector version; saved manual corrections remain intact. Detection is not OCR, and unusual borderless layouts can still need correction.

Switching guided mode off and back on keeps the selected panel on the same page. Returning to page view starts at the top; width/height fit changes within page view preserve the reading anchor. Navigating to a different page starts its own panel sequence.

The reader centers and scales the active panel, dims the surroundings, and changes **Next** to advance through the panels before advancing the page. Adjust confidence, surrounding dimness and padding in preferences. Left-to-right and right-to-left ordering are available.

**Detection is useful, but not perfect.** Overlapping artwork, narrative layouts, ads and some angled panels can still produce missed, extra or incorrectly ordered panels. The source models' published accuracy is not a measured accuracy guarantee for this application. Inspect `docs/VALIDATION.md` for what was actually tested.

Press E to correct any page: select outlines, remove incorrect panels, draw rectangles or arbitrary polygons, and move panels earlier/later. For polygon drawing, click each corner and click Finish (Enter). Ctrl+S saves. Corrections persist independently of automatic detector settings. Ctrl+R can explicitly replace a saved layout after confirmation. Source archives are never modified.

Saved corrections override detection on that page. They do not currently retrain or fine-tune the bundled neural models; training safely from a handful of personal corrections would tend to make the detector less reliable rather than more accurate.

## Webtoons

Continuous mode stacks images without gaps by default. Set the column width and image gap in preferences. It accepts ordinary multi-image archives, image folders, and stitched tall images. Images taller than 4,096 pixels are served as strips; pages far from the viewport are unloaded. Up/Down scroll normally, while Next/Previous jump to the next/previous image. The height control cycles through 125%, 100%, 75%, 50%, and 33% column zoom. Switch to Guided panels to detect and step through panels on a stitched image; it opens near your current scroll position. Overlapping detection tiles are merged at their seams. Panels cut across two separate image files are not joined automatically.

## Development and builds

Node.js 22.22 or later and npm are required only for building from source.

```sh
npm ci
npm run models       # downloads and verifies four pinned ONNX models (~35 MB)
npm start            # builds the UI and runs the desktop app
npm run dev          # Vite UI with the Electron shell
npm test
npm run pack:win     # build on Windows
npm run pack:linux   # AppImage + tar.gz on Linux
npm run pack:mac     # ad hoc signed Apple Silicon ZIP on macOS
```

Use `npm run pack:linux:tar` for a tar-only build. Cross-building from Windows requires the target-platform sharp packages: `npm install --no-save --force @img/sharp-linux-x64@0.35.4 @img/sharp-libvips-linux-x64@1.3.3`. Native ONNX Runtime binaries ship with its npm package for Windows, Linux, and macOS ARM64; Sharp installs the matching optional package on each native build host. Build tools and model downloads need network access; the finished reader does not.

### GitHub releases

Local packaging scripts write into the ignored `release/` folder; a normal Git push does not upload those files. `.github/workflows/release.yml` builds Windows portable + installer, Linux AppImage + tar, Apple Silicon macOS ZIP, and corresponding source on native runners. It tests before packaging and uploads all six artifacts plus SHA-256 checksums to a **draft** GitHub release when a tag matching `package.json` is pushed (for this version, `v0.3.9`). Commit and push the workflow and code before pushing the tag. Review the draft in GitHub Releases and publish it when ready. A manual Actions run from a branch builds downloadable workflow artifacts without creating a release. The workflow uses GitHub's repository token with `contents: write` only in its upload job; GitHub Actions must be enabled for the repository. Native builds and desktop feature checks have passed on all three platforms. Releases remain drafts until published.

If all three platform builds succeed but the upload job fails, run the workflow manually with that build's `build_run_id` and matching `release_tag` to retry only the upload. It verifies the build commit against the selected tag and requires three successful platform jobs before reusing their artifacts. AppImage filenames use `x86_64`; the Linux tar filename uses `x64`.

`npm run test:features` checks original-byte page exports, save destination and shortcut preferences, favorites across rescans/restarts, the UI version, and guided zoom stability at three viewport widths. Set `PANEL_READER_JITTER_SAMPLE` to a local omnibus archive to also test every detected panel on pages 8, 16, and 82 and compare their exported bytes against archive entries.

`npm run test:samples` fully decodes and detects each page in local sample archives and produces diagnostic overlays. Provide a JSON array of absolute archive paths through `PANEL_READER_SAMPLES`, or save it to the ignored `validation/sample-paths.json`. Set `PANEL_READER_SAMPLE_OUTPUT` to keep before/after reports in separate folders. `npm run test:navigation` checks Home, ten continuations, spatial keys at three window widths, and both chapter boundaries. `npm run test:desktop` drives the built Electron app with temporary settings and synthetic fixtures plus those sample archives. `npm run pack:source` creates a source ZIP, including model weights and licenses, excluding comics, test outputs and personal paths.

## Practical limits

- Password-protected archives, multipart RARs, and RAR files above 1.5 GB are not supported. Individual compressed image entries are limited to 256 MB and decoded images to 400 megapixels.
- JPEG, PNG, WebP, AVIF, GIF and TIFF page files are recognized. Animated images are treated as static pages; TIFF/GIF are normalized for display.
- First-page covers, loaded original pages, page dimensions, rendered strips, RAR payloads, and panel results are cached locally. Cached covers are served before touching their source, and versioned cover URLs are reused by the browser. Cover generation, page reading, and panel detection use separate workers. Automatic detections invalidate when archive size or modification time changes. Caches currently have no automatic disk eviction; the in-memory compressed-image cache targets 128 MB per worker.
- Library archive scanning includes every subfolder. Directory links are followed with real-path cycle detection, so linked collection folders work without creating scan loops. Image folders read immediate child images.
- The local builds are unsigned. The optional Windows installer creates app shortcuts; the portable release does not install the app. File associations are not registered. Local packaging does not publish to GitHub.

The application is AGPL-3.0-only because the bundled detector models carry AGPL requirements. See `THIRD_PARTY_NOTICES.md` and `models/manifest.json` for provenance and checksums.
