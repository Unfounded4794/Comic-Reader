---
license: agpl-3.0
library_name: onnxruntime
tags:
- onnx
- comic
- manga
- object-detection
- image-segmentation
- reading-order
---

# Poneglyph ReaderNet

ReaderNet is the browser inference bundle used by Poneglyph to detect speech bubbles and manga panels, assign every bubble to one panel, order panels, then order bubbles **inside each panel only**.

## Files

- `bubble_detector.onnx`: YOLO26n end-to-end speech-bubble detector, input `1×3×800×800`, output `1×300×6`.
- `panel_detector.onnx`: YOLO11n-seg panel detector, input `1×3×1504×1504`; the web application uses its NMS boxes and represents them as four-point rectangular polygons for the ordering features.
- `ordering.onnx`: one ONNX graph/session containing two independent MLP heads: `panel_features[*,96] → panel_logits[*]` and `bubble_features[*,102] → bubble_logits[*]`.
- `model_manifest.json`: immutable hashes, tensor contracts and provenance.
- `parity_report.json`: source-versus-fused ONNX numerical parity.
- `metrics/`: training, shared-detector comparison and end-to-end reports.

## Runtime algorithm

1. Detect panels and bubbles.
2. Rank panels from all directed panel pairs by summed sigmoid probabilities.
3. Assign each bubble by center containment; use the smallest containing panel when overlaps exist, otherwise the nearest panel boundary.
4. Batch all directed bubble pairs across panels into the bubble head.
5. Rank bubbles independently inside each panel. There is no global bubble sorter.

The two rankers were fused to reduce model downloads and ONNX Runtime session setup. They remain independent heads so their predictions are numerically identical to the original ONNX exports.

## Reported validation

- Panel ordering with annotated polygons: 51/51 validation pages exact (100%).
- Bubble ordering with a shared `bubble_detector.onnx` and shared annotated panels: 132/138 exact multi-bubble panels (95.65%), versus 127/138 (92.03%) for the previous published pipeline.
- Browser-compatible bounding rectangles represented as four-point polygons: panel order 51/51 exact pages (100%); bubble order 131/139 exact multi-bubble panels (94.24%).
- End-to-end with predicted panels and reference bubble boxes: 125/139 exact multi-bubble panels (89.93%); bubble-to-panel assignment accuracy 428/438 (97.72%).

See the JSON reports for datasets, splits, protocols and full metrics. Detector artifacts exported by Ultralytics are distributed under AGPL-3.0; see Ultralytics licensing terms for deployment obligations.
