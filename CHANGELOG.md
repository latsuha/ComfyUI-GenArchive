# Changelog

## 1.0.0

First public release.

- **Generation Archive** node: records every result together with the reference images it was made from (copies are stored once, even when reused in hundreds of generations). Works with normal loaders and batch loaders.
- **Archive Container** node: loads the references of any image of a category back into a workflow; results of regenerations are named `gen_0007_reg_1`, `gen_0007_reg_2` automatically.
- Fullscreen **viewer**: grid, categories with hotkeys, versions (original / regenerations), delete, session switcher.
- **Color correction** panel: exposure, contrast, gamma, saturation, vibrance, warmth, R/G/B channels, sharpness, grain, color noise; presets; apply to many images; overwrite (with Revert) or save a copy `_color_N`.
- **Color brush**: paint a color correction only where you want it, with intensity.
- **Retouch from a reference**: bring details back from a reference or another version (layer move/scale/rotate, brush with size/hardness/flow, Photoshop-like blend modes); saved as `_fix_N` or in place.
- Customizable **keyboard shortcuts** (layout independent).
