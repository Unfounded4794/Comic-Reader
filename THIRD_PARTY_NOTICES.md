# Third-party notices

Panel Reader is distributed under GNU AGPL v3. The complete application source and build instructions accompany the local release in `Panel-Reader-0.1.0-source.zip`.

## Panel models

- **Inkwell Western panel detector**, by cedarrapidsboy, derived from Ultralytics YOLOv8. AGPL-3.0. https://huggingface.co/cedarrapidsboy/inkwell-panel-models
- **Inkwell panel reading-order model**, by cedarrapidsboy. MIT. The feature contract in `core/panels.mjs` follows the model author's published reference. The original reference is retained in `models/reference-order.py`.
- **Poneglyph ReaderNet panel segmentation model**, by Remidesbois, based on Ultralytics YOLO11. AGPL-3.0. https://huggingface.co/Remidesbois/Poneglyph-ReaderNet
- **Ultralytics YOLO**, Copyright Ultralytics. AGPL-3.0. https://github.com/ultralytics/ultralytics

Model revisions, byte sizes, and SHA-256 hashes are pinned in `models/manifest.json`. Full model cards are included with the application. Reported model-author metrics are not measurements of this app on the user's collection.

## Runtime and libraries

- Electron: MIT; Chromium and other included component notices are in the distribution's `LICENSES.chromium.html`.
- React and React DOM: MIT.
- ONNX Runtime: MIT, Copyright Microsoft Corporation. Component notices and licenses are retained in its package.
- sharp: Apache-2.0; libvips: LGPL-2.1-or-later, distributed as a separate shared library. Component licenses are retained under `node_modules/@img`.
- yauzl: MIT, Copyright Josh Wolfe.
- node-unrar-js: MIT wrapper, Copyright Yu Jianrong. The embedded UnRAR decompressor is subject to the UnRAR license: it may not be used to develop a RAR-compatible archiver/compressor. This app only decompresses archives. See the license shipped in `node_modules/node-unrar-js`.

Dependency package license files are retained in the distribution. Build-only tools (Vite, electron-builder, Playwright and yazl) are not part of the shipped reader runtime. The user's sample comics and generated screenshots of their pages are excluded from every release package and source archive.
