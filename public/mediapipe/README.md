# MediaPipe Hands

Optional camera control. The landmarker model and SIMD wasm are fetched at
build time by `scripts/fetch_mediapipe.py`. They are not uploaded from the
notebook; the camera stays in the browser.

- Hand Landmarker (float16): [Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
- `@mediapipe/tasks-vision` is Apache 2.0
