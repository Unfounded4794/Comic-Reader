#!/usr/bin/env python3
"""
Bare-minimum example: detect comic panels on a page image and predict
their reading order, using the two ONNX models published in this repo's
Hugging Face model card (panel-detector.onnx + panel-order-model.onnx).

pip install onnxruntime opencv-python numpy
"""

from __future__ import annotations

import sys

import cv2
import numpy as np
import onnxruntime as ort

DETECTOR_PATH = "best.onnx"      # YOLOv8-n panel detector
ORDER_PATH = "panel-order-model.onnx"      # pairwise reading-order classifier

CONF_THRESH = 0.25
NMS_THRESH = 0.45
IMG_SIZE = 640


def detect_panels(image_bgr: np.ndarray, session: ort.InferenceSession) -> list[dict]:
    """Run the YOLOv8-n detector and return panel boxes as page-relative
    (0..1) {x, y, w, h} dicts, x/y being the top-left corner."""
    # NOTE: plain resize, not letterboxed — fine for this example, but a
    # production pipeline should letterbox (pad to square) like Ultralytics
    # does during training, for best accuracy on non-square pages.
    resized = cv2.resize(image_bgr, (IMG_SIZE, IMG_SIZE))
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    blob = np.transpose(rgb, (2, 0, 1))[None]  # NCHW

    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: blob})[0][0].T  # (N, 5): cx,cy,w,h,conf

    boxes_xywh, scores = [], []
    for cx, cy, w, h, conf in output:
        if conf < CONF_THRESH:
            continue
        boxes_xywh.append([float(cx - w / 2), float(cy - h / 2), float(w), float(h)])
        scores.append(float(conf))
    if not boxes_xywh:
        return []

    keep = cv2.dnn.NMSBoxes(boxes_xywh, scores, CONF_THRESH, NMS_THRESH)

    panels = []
    for i in np.array(keep).flatten():
        x, y, w, h = boxes_xywh[i]
        # boxes are in the 640x640 resized pixel space, so dividing by
        # IMG_SIZE gives page-relative (0..1) coordinates directly.
        panels.append({"x": x / IMG_SIZE, "y": y / IMG_SIZE,
                        "w": w / IMG_SIZE, "h": h / IMG_SIZE})
    return panels


def _positive_class_probs(outputs: list) -> np.ndarray:
    """skl2onnx classifiers output [labels, probabilities]. `probabilities`
    is either a plain (N, 2) array, or — if ZipMap wasn't disabled at
    export time — a list of {0: p0, 1: p1} dicts."""
    probs = outputs[1]
    if isinstance(probs, list):
        return np.array([p[1] for p in probs], dtype=np.float64)
    return np.asarray(probs)[:, 1]


def order_panels(panels: list[dict], session: ort.InferenceSession) -> list[int]:
    """Return panel indices (into `panels`) in predicted reading order."""
    n = len(panels)
    if n <= 1:
        return list(range(n))

    for p in panels:
        p["cx"] = p["x"] + p["w"] / 2
        p["cy"] = p["y"] + p["h"] / 2
        p["x2"] = p["x"] + p["w"]
        p["y2"] = p["y"] + p["h"]

    med_h = float(np.median([p["h"] for p in panels]))
    n_norm = n / 20.0

    def pair_features(a: dict, b: dict) -> list[float]:
        """Same 14 features the model was trained on — order matters."""
        dx, dy = b["cx"] - a["cx"], b["cy"] - a["cy"]

        shorter_h = min(a["h"], b["h"])
        v_ovl = max(0.0, min(a["y2"], b["y2"]) - max(a["y"], b["y"]))
        v_ovl = v_ovl / shorter_h if shorter_h > 0 else 0.0

        shorter_w = min(a["w"], b["w"])
        h_ovl = max(0.0, min(a["x2"], b["x2"]) - max(a["x"], b["x"]))
        h_ovl = h_ovl / shorter_w if shorter_w > 0 else 0.0

        h_ratio = a["h"] / b["h"] if b["h"] > 0 else 1.0
        w_ratio = a["w"] / b["w"] if b["w"] > 0 else 1.0
        a_left, b_left = float(a["cx"] < 0.5), float(b["cx"] < 0.5)
        a_top, b_top = float(a["cy"] < 0.5), float(b["cy"] < 0.5)
        a_tall = float(a["h"] > med_h * 1.4)
        b_tall = float(b["h"] > med_h * 1.4)
        same_row_right = float(v_ovl >= 0.3 and dx > 0)

        return [dx, dy, v_ovl, h_ovl, h_ratio, w_ratio,
                a_left, b_left, a_top, b_top, a_tall, b_tall,
                n_norm, same_row_right]

    input_name = session.get_inputs()[0].name
    scores = np.zeros(n)
    for i in range(n):
        batch = np.array(
            [pair_features(panels[i], panels[j]) for j in range(n) if j != i],
            dtype=np.float32,
        )
        outputs = session.run(None, {input_name: batch})
        probs = _positive_class_probs(outputs)  # P(panel i before panel j)
        scores[i] = probs.sum()

    return list(np.argsort(-scores))  # highest "beats" score read first


def main(image_path: str) -> None:
    det_session = ort.InferenceSession(DETECTOR_PATH)
    order_session = ort.InferenceSession(ORDER_PATH)

    image = cv2.imread(image_path)
    if image is None:
        raise SystemExit(f"Could not read image: {image_path}")

    panels = detect_panels(image, det_session)
    print(f"Detected {len(panels)} panels")

    order = order_panels(panels, order_session)
    print("Reading order:")
    for rank, idx in enumerate(order):
        p = panels[idx]
        print(f"  {rank + 1}. panel {idx}  "
              f"x={p['x']:.3f} y={p['y']:.3f} w={p['w']:.3f} h={p['h']:.3f}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(f"Usage: python {sys.argv[0]} <page_image.jpg>")
    main(sys.argv[1])
