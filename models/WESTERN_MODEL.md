---
license: other
tags:
- object-detection
- yolov8
- yolo
- ultralytics
- gradient-boosting
- scikit-learn
- comics
- computer-vision
- panel-detection
- reading-order
library_name: ultralytics
pipeline_tag: object-detection
base_model:
- Ultralytics/YOLOv8
---

# Inkwell Panel Models

Two models for automated comic panel processing, trained on the same
hand-annotated comic page corpus:

1. **[Panel Detector](#1-panel-detector-yolov8-n)** — locates panel bounding
   boxes on a comic page (object detection, YOLOv8-n).
2. **[Panel Reading Order](#2-panel-reading-order-gradient-boosting-classifier)** —
   given a page's detected panels, predicts the order a reader should view
   them in (pairwise gradient-boosted classifier).

They're meant to be used together: run the detector on a page to get panel
boxes, then run the ordering model on those boxes to get a reading sequence.
Each model has its **own license** — see [License](#license) below, they are
not the same.

---

## 1. Panel Detector (YOLOv8-n)

A YOLOv8-nano object detection model that locates **comic panels** on scanned
or digital comic book pages.

### Model description

- **Task:** single-class object detection
- **Class:** `panel` (`class_id 0`) — the rectangular (or near-rectangular)
  bounded region of a single comic panel on a page. The model does not
  distinguish panel shape, gutter, speech balloons, or reading order — it
  only predicts the bounding box of each panel.
- **Architecture:** [YOLOv8-n](https://github.com/ultralytics/ultralytics)
  (nano), fine-tuned from the pretrained `yolov8n.pt` COCO checkpoint.
- **Input size:** 640×640
- **What it's for:** automatically detecting panel boundaries on a comic page
  so downstream tools can crop, reorder, or reflow panels — e.g. guided
  panel-by-panel reading, panel extraction for translation/OCR pipelines, or
  building reading-order datasets. This is the "edge" tier model:
  small and fast enough for on-device / mobile inference.

### Training data

- **~3,800 annotated comic book pages** (3,380 train / 423 validation, plus a
  held-out test split) drawn from a range of **genres and art styles**
  (e.g. superhero, manga-influenced, indie/alternative, all-ages), so the
  model isn't overfit to one visual style or layout convention.
- Every panel bounding box was **hand-tuned** — each page's annotation was
  manually created or corrected before being ingested into the training set.
- Pages with **no panels** (e.g. full-page splash art, covers) were included
  with empty label files as negative examples, so the model also learns to
  correctly predict *zero* panels on non-paneled pages.
- Labels use standard YOLO format: `<class_id> <cx> <cy> <w> <h>`, normalized
  to 0–1, single class (`panel`).

### Training procedure

Trained from the `yolov8n.pt` pretrained checkpoint using
[Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics).

| Parameter | Value |
|---|---|
| Base weights | `yolov8n.pt` |
| Image size | 640 |
| Epochs | 300 (early-stopping patience 30) |
| Batch size | 16 |
| Mosaic augmentation | 1.0 |
| Mixup augmentation | 0.0 |
| Train / Val pages | 3,380 / 423 |

### Results

| Model | Type | Epochs | Batch | imgsz | Train pages | Val pages | Precision | Recall | mAP@50 | mAP@50-95 |
|---|---|---|---|---|---|---|---|---|---|---|
| comic-panels-v1 | nano | 300 | 16 | 640 | 3,380 | 423 | 0.9681 | 0.9331 | 0.9769 | 0.9249 |

### Limitations

- Trained on comic *pages* — performance on non-comic images, storyboard art,
  or extremely non-standard/artistic panel layouts (irregular borders,
  panel-less "flow" layouts) is not guaranteed.
- Detects panel bounding boxes only; it does not infer reading order, panel
  type, or contents (speech bubbles, characters, etc.). That's handled by the
  second model in this repo.
- Single-class model — all detections are labeled `panel` regardless of
  panel shape or size.

---

## 2. Panel Reading Order (Gradient Boosting Classifier)

A pairwise reading-order model. Given the panel boxes on a comic page (e.g.
from the detector above, or any other source), it predicts the order a
reader should view them in — handling non-obvious layouts like Z-paths,
tall panels that span both a left and right column, splash panels, and
nested/overlapping panels, without hardcoded row/column rules.

### Model description

- **Task:** pairwise ranking / reading-order prediction over a variable
  number of panels on a page.
- **Architecture:** `sklearn.ensemble.GradientBoostingClassifier`
  (100 estimators, max depth 4, learning rate 0.1). For every ordered pair of
  panels `(a, b)` on a page, 14 geometric features are computed (relative
  position, vertical/horizontal overlap, aspect-ratio, tallness, page-column
  side, panel-count normalization, etc. — see `FEATURE_NAMES` in the
  training script) and the classifier predicts `P(a is read before b)`.
  Each panel's final rank comes from summing its "beats" probability against
  every other panel on the page and sorting descending.
- **Not a neural network** — pure gradient-boosted trees over geometry
  features, so inference is microseconds per page.
- **Shipped format:** `panel-order-model.onnx`, exported from the trained
  scikit-learn classifier via `skl2onnx`. GradientBoostingClassifier (rather
  than the faster HistGradientBoostingClassifier used by an internal v2
  candidate) is used specifically because it converts to ONNX reliably,
  letting this model run in-browser via onnxruntime-web.

### Training data

Same underlying corpus as the panel detector: comic pages with hand-tuned
panel boxes **and** a hand-verified reading-order index per panel, pulled
from `panels.json` annotations across the same range of genres and art
styles. Only pages with ≥2 panels and an `approved` annotation flag are used
(single-panel and unapproved pages are skipped, since there's no ordering
signal to learn from a single panel).

### Training procedure

- Trained with leave-one-file-out cross-validation: for each comic file, the
  model is trained on every *other* file and evaluated on the held-out one,
  so reported accuracy reflects generalization to unseen books, not just
  unseen pages of a book already seen in training.
- Every panel pair on a page contributes two training examples (`a before b`
  and `b before a`), so the effective training set is much larger than the
  page count alone suggests.

### Results

Leave-one-file-out cross-validation, page-level exact-match accuracy (the
predicted order must match the human-annotated order for every panel on the
page to count as correct):

| Metric | Value |
|---|---|
| Pages evaluated | 3,610 |
| Pages perfectly ordered | 3,493 |
| **Page-level accuracy** | **96.76%** |

Accuracy by layout pattern (a page can match more than one pattern):

| Pattern | Accuracy | Pages |
|---|---|---|
| Simple grid | 98.58% | 494 |
| 2–3 panels | 99.52% | 419 |
| 4–6 panels | 97.99% | 2,585 |
| Unequal columns | 96.76% | 1,451 |
| Has overlapping panels | 95.97% | 2,233 |
| Has splash panel | 95.48% | 1,770 |
| 7–10 panels | 91.06% | 559 |
| Has nested panels | 91.91% | 544 |
| 11+ panels | 72.34% | 47 |

Accuracy degrades on the densest, least common layouts (11+ panels on a
single page), which is also the smallest evaluation bucket.

### Limitations

- Accuracy drops on pages with very high panel counts (11+) — these are rare
  in the training corpus, so the model has seen fewer examples of that
  layout complexity.
- Predicts order from **geometry only** — it doesn't read panel content, so
  narratively-driven reading orders that contradict geometric layout (rare,
  but they exist in some comics) won't be captured.
- Expects panel boxes as input (from the detector above or another source);
  it does not detect panels itself.

---

## License

**The two models in this repo are licensed differently — check which one
you're using.**

### Panel Detector — AGPL-3.0

The panel detector is a **derivative of [Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics)**,
which Ultralytics distributes under the
[GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.en.html).
Because these weights were produced by fine-tuning Ultralytics' pretrained
`yolov8n.pt` checkpoint, the detector weights are likewise distributed under
**AGPL-3.0**.

In practice, this means:

- You are free to use, modify, and redistribute this model, **provided any
  distribution (including source code) also uses/discloses source under
  AGPL-3.0**.
- If you run this model (or a modified version of it) as part of a network
  service (e.g. a hosted API or web app), AGPL-3.0's network-use clause
  requires you to make the complete corresponding source code of that
  service available to its users.
- If you need to use this model in a closed-source or proprietary product
  without these obligations, Ultralytics offers a commercial
  [Enterprise License](https://www.ultralytics.com/license) — see their site
  for details. That commercial license applies to the underlying YOLOv8
  architecture/code; you would need to confirm licensing terms for these
  specific fine-tuned weights with their author before using them under
  such a license.

Full AGPL-3.0 license text: https://www.gnu.org/licenses/agpl-3.0.en.html

#### Attribution

This model builds on:

```
Ultralytics YOLOv8
https://github.com/ultralytics/ultralytics
Copyright (C) Ultralytics
Licensed under AGPL-3.0
```

If you use the detector, please also cite Ultralytics YOLOv8:

```bibtex
@software{yolov8_ultralytics,
  author = {Glenn Jocher and Ayush Chaurasia and Jing Qiu},
  title = {YOLO by Ultralytics},
  version = {8.0.0},
  year = {2023},
  url = {https://github.com/ultralytics/ultralytics},
  license = {AGPL-3.0}
}
```

### Panel Reading Order — MIT

The reading-order model is trained from scratch on top of
`scikit-learn` (BSD-3-Clause) and does not derive from or embed any AGPL
code or weights, so it does not carry the detector's AGPL-3.0 obligations.
It's released under the **MIT License**.