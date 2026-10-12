# Validation

The reader was developed and tested on Windows on 2026-09-26–28, 2026-10-01, and 2026-10-13. Linux x64 is a packaging target; no CachyOS desktop was available for execution testing.

## 0.3.6 macOS bundle packaging

The first tagged GitHub release attempt confirmed that the Windows build succeeds and the feature suite passes on native Linux and Apple Silicon runners. The Mac package failed during ad hoc signing because the global `extraFiles` rules placed the README directly in `Contents`. macOS now copies documentation into `Contents/Resources`; Windows and Linux retain their documentation beside the executable. Local checks use electron-builder's actual file matchers to verify that Mac has no `extraFiles`, retains its model resources, and places both documentation files under Resources. The corrected release uses version 0.3.6; no reader behavior changes are included.

## 0.3.5 original page exports, favorites, and stable panel zoom

All 31 unit tests, 13 existing navigation scenarios, and 15 existing desktop scenarios pass on Windows. The new feature suite passes against the unpacked Windows release. It covers choosing a saved-pages destination, rebinding both new shortcuts, exporting original JPEG bytes from a CBZ, saving the image at the current continuous-scroll position, exporting an entire 18,000-pixel PNG despite tiled display, preventing identical duplicate saves, and preserving different same-named files. A real RAR-format CBR entry also exports byte for byte with its original extension. Unit checks cover invalid/path-like archive names and settings normalization.

Favorite controls and shortcuts are exercised in both the reader and the library. Favorites survive a library rescan and an app restart, and removal updates the collection. The UI version is compared against package metadata. Screenshots of saved-page preferences and Favorites were inspected locally; test data and screenshots remain in ignored `validation/` paths.

Guided mode reserves both scrollbar axes, avoiding a feedback loop between the measured viewport and the fitted page size. It also waits for the target page's panel layout instead of briefly fitting the previous page's layout. Synthetic wide, tall, and full-page panels remain stable at viewport widths of 760, 1000, and 1440 pixels. For each frame, the tests sample the artwork dimensions, viewport dimensions, and both scroll offsets for 90 animation frames and require the final 75 frames to be identical. Returning from guided to fit-width still starts at the top.

Every detected panel on the user's Super Sons omnibus pages 8, 16, and 82 is checked with the same frame sampling against the packaged Windows app. The local sample remains unchanged and is not bundled or uploaded. This checks camera stability on the reported pages, not panel-detection accuracy for the whole omnibus. Reports include each panel's final size and scroll position.

Windows portable and NSIS installer releases, Linux x64 tar, and matching source are built for 0.3.5. Package inspection matches 15 application files and all four model hashes in both platforms, checks the correct native libraries, verifies the Linux ELF architecture, and confirms executable archive modes. The Windows executable metadata reports version 0.3.5. Windows app/window identity and portable relaunch properties are configured; taskbar pinning has not been manually tested and the installer is recommended for a stable shortcut target.

The new GitHub release workflow is parsed locally and configured to test/build on Windows, Linux, and native Apple Silicon macOS runners, then upload a draft release for a matching version tag. No remote workflow run or upload has occurred. Mac packaging/runtime and Linux runtime are not claimed as locally tested.

## 0.3.4 webtoon panel handoff and platform packages

All 28 unit tests, 13 navigation scenarios, and 15 desktop scenarios passed on Windows. Both Electron suites also passed against the unpacked Windows build. The navigation regression confirms that leaving guided mode starts page view at the top while re-entering guided mode retains the selected panel. It also checks that entering guided mode from a scrolled continuous image selects the nearby panel. The desktop suite checks the new 125% and 100% webtoon zoom steps.

A 3,696-pixel stitched image made from three local comic pages produced detected panels in guided mode. Cross-tile seam merging reduced 26 stops to 20 by removing clipped duplicate detections; this is a focused sample, not an accuracy claim for all webtoons. Panels split between separate source images are not joined. The Windows portable launcher exceeded Playwright's 60-second startup timeout during a direct test; the unpacked Windows app passed both suites.

`Panel-Reader-0.3.4-Windows-x64.exe` and `Panel-Reader-0.3.4-Linux-x64.tar.gz` were built. Release inspection matched 14 application files and all four model hashes in both unpacked targets, found the target native libraries, confirmed the Linux launcher is ELF x86-64, and verified the three Linux executable modes in the tar archive. The Apple Silicon macOS target is configured but electron-builder 26 requires a Mac host to build it; no Mac artifact or runtime test is claimed.

## 0.3.3 guided fitting, manga direction, and library focus

All 27 unit tests and both Electron suites pass from source. The same 15 desktop scenarios and 13 navigation scenarios also pass against the packaged Windows application. Navigation is checked at 1000, 1280, and 1920 pixel widths, including Home entering Continue Reading, root-only sidebar folders, spatial movement from search and sort, backward issue transitions, and retaining the active panel when guided mode is toggled.

The guided-fit regression uses one very wide and one very tall saved panel. It verifies that every edge of both frames remains inside the reading viewport, all page-fit controls are disabled while guided mode owns the camera, and W/H cannot alter the stored page fit until guided mode is closed. Manga mode is checked for reversed Left/Right panel and page turns, corresponding footer actions, and right-to-left ordering on an automatically detected four-panel page from the supplied Haikyu chapter 1 archive. The Haikyu dialogue-protection check still passes.

`Panel-Reader-0.3.3-Windows-x64.exe` and `Panel-Reader-0.3.3-Linux-x64.tar.gz` were built. Release inspection matched 14 application files and all four model hashes in both unpacked targets, found the correct Windows and Linux native libraries, confirmed the Linux launcher is ELF x86-64, and verified executable modes for `panel-reader`, `chrome-sandbox`, and `chrome_crashpad_handler` in the tar archive.

## 0.3.2 local region recovery and reading position

The five supplied archives were fully decoded and processed again, including every page in both Superman issues and Young Justice. All **139 pages** completed without archive, decode, or inference errors. The final automatic layouts contain no `page-context` overview stops and never mix a whole-page fallback with close-ups. The detector now recovers uncovered local regions, expands clipped neighbours and margins, rejects nested props, and prevents inconsistent secondary boxes from swallowing established panels. A single whole-page stop remains appropriate for illustrations or insufficient panel evidence.

| Archive | Pages tested | Lowest page coverage | Lowest artwork coverage |
| --- | ---: | ---: | ---: |
| Haikyu!! Color chapter 1 | 55 | 92.15% | 97.58% |
| Haikyu!! Color chapter 295 | 16 | 91.68% | 98.30% |
| Superman 006 (2016) | 25 | 97.70% | 98.08% |
| Superman 015 (2017) | 20 | 97.59% | 97.84% |
| Young Justice 06 (1999) | 23 | 96.77% | 99.99% |

Coverage is the rasterized union of the reveal polygons and protected speech bubbles. Page coverage counts the entire canvas. The artwork measure excludes uniform near-white and near-black pixels while including contrasting edges; it is a content heuristic, not human-labelled semantic accuracy. Extending a frame into a margin is counted, overlapping frames are counted once, and no overview is included to inflate the metric. All final pages exceed 90% canvas coverage and 97% measured artwork coverage. Detection can still merge or over-segment complex borderless art, and rectangular automatic frames can include parts of neighbouring diagonal panels. No precision/recall claim is made.

Numbered contact sheets for all pages were visually inspected during refinement. Additional concrete regressions include Superman 006 page 19's missing window scene (three stops), Superman 015 page 9's right-hand Aquaman region (three), Superman 015 page 14's fragmented table scene (five), Young Justice page 5's small portrait column (ten), page 13's false comic-cover detections (three), and page 17's false clock detection (seven). Page numbers include covers and advertisements. Ten reviewed page-count checks complement the coverage checks; these limited annotations are not a full ground-truth dataset.

The final full-resolution report and contact sheets are in ignored `validation/region-recovery`; intermediate raw model outputs and previews are in `validation/candidates` and `validation/layout-review`. Inputs remain local and unchanged. Reproduce with a JSON array of local archive paths in `PANEL_READER_SAMPLES`, set `PANEL_READER_SAMPLE_OUTPUT=validation/region-recovery`, run `npm run test:samples`, then `node scripts/audit-panel-report.mjs`. The latter checks all 139 pages, disallows overview stops, and asserts the ten reviewed layouts. Cached previews accelerate iteration; the final reported measurements come from original archive images.

All 27 unit tests pass. The packaged Windows application passes 25 desktop scenarios (15 reader tests and 10 navigation/position tests). The new regression selects panel four, switches through page width and height, verifies the viewport stays near that panel, reopens the comic, and confirms that changing pages resets the panel sequence. A real Haikyu chapter 1 page 33 speech bubble extending outside its panel is also verified inside both the camera frame and reveal mask. Automatic cache keys use `ensemble-4-region-recovery`; manual corrections are preserved.

## 0.3.1 navigation and dialogue regression checks

The five additional local archives were decoded and analyzed before and after the detector changes: Haikyu!! Color chapters 1 (55 pages) and 295 (16), Superman 006 (25) and 015 (20), and Young Justice 06 (23), for **139 pages**, with no archive, image-decode, or inference errors. Inputs remained local and unchanged. Reports and contact sheets are in the ignored `validation/before` and `validation/after` directories.

Before the changes, 26 pages had less than 72% visible outline coverage. The updated pipeline recovers shape-model candidates such as the large top panel on Haikyu chapter 1, page 9, assigns detected speech bubbles to one panel, and includes their full rectangles in camera framing and the dimming mask. A whole-page overview precedes close-ups when the union of visible regions covers less than 72% of the page or 92% of non-white artwork. Single/tiny detections use a full-page fallback. These checks run independently for each tile on tall pages. All 139 resulting layouts exceed 72% page coverage; the lowest measured union coverage was 77.7%. This includes overview safeguards and **is not panel-detection accuracy**. Contact sheets were visually inspected, including the recovered Haikyu panel and previously missed Superman page areas. Borderless art, some captions, and ordering remain imperfect; no ground-truth precision/recall claim is made.

The 21 unit tests include visible-union coverage (overlaps and concave outlines), bubble ownership and framing, preserving dialogue when saving/reordering outlines, Home child/leaf/empty roots, ten continuations, natural previous/next issues, and aligned spatial navigation. The separate Electron navigation suite checks matching Home counts, collection placement, ten continuation cards, keyboard movement at 1000/1280/1920px widths, Enter activation, first/last-page crossing in page and guided modes, and disabled/bounded transitions. Its additional real-page check uses Haikyu chapter 1, page 15 to verify a bubble extending below its panel stays inside the guided camera frame and undimmed mask. The existing 15 desktop scenarios cover the broader reader. All 24 desktop checks passed against the packaged Windows application, with isolated profiles and fixture libraries. The real-page screenshot is saved as `validation/ui-dialogue-protection.png`.

The added 9.9 MB speech-bubble model is pinned to the same Poneglyph revision as the shape model and verified against the model author's SHA-256 contract. The detector cache version changes automatically; manual layouts continue to override automatic detection.

## Real archive checks

The user's four supplied files were read from their existing locations, without modification or uploading:

| Comic | Container detected by file signature | Image pages |
| --- | --- | ---: |
| Ben 10 001 (2026) | ZIP | 30 |
| Impulse 01 (1995) | ZIP | 25 |
| Super Sons 001 (2017) | RAR | 26 |
| Batman and Robin 001 (2023) | RAR | 28 |
| **Total** | | **109** |

Every image was extracted and fully decoded, and the model pipeline was executed on every page. These checks establish archive/decode compatibility and inference execution, **not** that every inferred panel boundary or order is correct. The local, ignored `validation/sample-report.json` records results and timings, and contact sheets show numbered outlines.

Visual inspection found strong results on conventional multi-panel pages and useful detection of nested insets. It also found duplicate/partial detections when simply combining models; the final pipeline uses the Western model as authority, requires stronger evidence for additional detections, and retains whole-page views when only one region is found. Covers, promotional pages, and intricate overlapping layouts remain difficult. No comprehensive human ground-truth set was supplied, so no precision/recall percentage is claimed.

## Automated checks

Ten core tests cover ZIP signature handling, standalone JPG/PNG handling, natural page ordering, deep recursive rescans, overlapping watched roots, preserved folder hierarchy, direct-versus-descendant folder views, series history and natural next-issue selection, missing-file history, configurable shortcuts, settings validation, inset-preserving suppression, polygon persistence/validation, and the reading-order tensor contract.

The Electron integration suite has 15 scenarios. It exercises native folder selection through a controlled test dialog, hierarchy-first Home and deep nested-folder navigation, discovery of an added archive after rescan, series history and next-issue cards, changing and removing watched roots, standalone JPG decoding, automatic webtoon mode and five-strip serving for a standalone 18,000-pixel PNG, exact Up/Down scroll distances, setting a background color, rebinding Next, clean fullscreen, guided Next changing panel without changing page, saved panel-order corrections, drawing and saving arbitrary polygon corrections, real CBR rendering, and continuous image-folder reading. It also checks that webtoon position survives returning to the library and switching reading modes. Screenshots and test reports are saved locally under the ignored `validation` directory.

The final Windows distribution is tested with the same scenarios against the packaged executable and its bundled native dependencies. The Linux tar archive is inspected for the expected Linux x64 native libraries, pinned model hashes, matching application code, and executable permissions on `panel-reader`, `chrome-sandbox`, and `chrome_crashpad_handler`. Archive inspection is not a substitute for execution on CachyOS.

The app uses a sandboxed renderer with a narrow preload bridge, no Node integration in the page, blocked external navigation, and custom protocols restricted to selected library IDs. Archive member names never become extraction paths: decompression happens in memory. Heavy decompression, image processing and model inference run in a worker thread. Neural models are loaded from bundled, pinned artifacts; no remote Python code is executed.
