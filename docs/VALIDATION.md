# Validation

The reader was developed and tested on Windows on 2026-09-26–27. Linux x64 is a packaging target; no CachyOS desktop was available for execution testing.

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

Seven core tests cover ZIP signature handling, natural page ordering, recursive rescans and missing-file history, configurable shortcuts, settings validation, inset-preserving suppression, polygon persistence/validation, and the reading-order tensor contract.

The Electron integration suite has 12 scenarios. It exercises native folder selection through a controlled test dialog, discovery of an added archive after rescan, exact Up/Down scroll distances, setting a background color, rebinding Next, clean fullscreen, guided Next changing panel without changing page, saved panel-order corrections, drawing and saving arbitrary polygon corrections, real CBR rendering, and continuous image-folder reading with an 18,000-pixel stitched image split into five strips. It also checks that webtoon position survives returning to the library and switching reading modes. Screenshots and test reports are saved locally under the ignored `validation` directory.

The final Windows distribution is tested with the same scenarios against the packaged executable and its bundled native dependencies. The Linux tar archive is inspected for the expected Linux x64 native libraries, pinned model hashes, matching application code, and executable permissions on `panel-reader`, `chrome-sandbox`, and `chrome_crashpad_handler`. Archive inspection is not a substitute for execution on CachyOS.

The app uses a sandboxed renderer with a narrow preload bridge, no Node integration in the page, blocked external navigation, and custom protocols restricted to selected library IDs. Archive member names never become extraction paths: decompression happens in memory. Heavy decompression, image processing and model inference run in a worker thread. Neural models are loaded from bundled, pinned artifacts; no remote Python code is executed.
