# Changelog

## 1.0.2

Security hardening, second round of the ComfyUI-Manager review.

- **Strict by default:** the original file of a reference (`path_1 … path_4`) is now used only if it is a real image inside ComfyUI's own `input` / `output` / `temp` folders. Folders that are merely configured on a loader node in a workflow are **no longer trusted** (a workflow must not decide what the node may read); in that case the image that came through the `ref_N` pin is stored instead.
- New, opt-in and controlled by the person who runs ComfyUI (not by a workflow): the environment variable `GENARCHIVE_TRUSTED_FOLDERS` (folders separated by `;` on Windows, `:` elsewhere) lists extra folders whose original files may be archived. A one-time console hint explains this when a reference is read from an untrusted folder.
- `GENARCHIVE_STRICT_PATHS` (added in 1.0.1) is gone: strict is now the default.

## 1.0.1

Security fix (reported during the ComfyUI-Manager review - thank you!).

- **The `path_1 … path_4` inputs of *Generation Archive* no longer accept arbitrary files.** Before, a workflow could pass any absolute path and make the node copy that file (a key, a config...) into the archive, from where the viewer could serve it. Now a path is used only if it is a *real image file* (verified, not just by extension) that lies inside ComfyUI's input / output / temp folders or inside a folder configured on the connected loader node. Anything else is ignored and the image that came through the `ref_N` pin is stored instead. `..` traversal and symlinks pointing outside are rejected too. Set the environment variable `GENARCHIVE_STRICT_PATHS=1` to trust only ComfyUI's own folders.
- Files named in `registry.json` (Archive Container, category export) must stay inside the session folder.

## 1.0.0

First public release.

- **Generation Archive** node: records every result together with the reference images it was made from (copies are stored once, even when reused in hundreds of generations). Works with normal loaders and batch loaders.
- **Archive Container** node: loads the references of any image of a category back into a workflow; results of regenerations are named `gen_0007_reg_1`, `gen_0007_reg_2` automatically.
- Fullscreen **viewer**: grid, categories with hotkeys, versions (original / regenerations), delete, session switcher.
- **Color correction** panel: exposure, contrast, gamma, saturation, vibrance, warmth, R/G/B channels, sharpness, grain, color noise; presets; apply to many images; overwrite (with Revert) or save a copy `_color_N`.
- **Color brush**: paint a color correction only where you want it, with intensity.
- **Retouch from a reference**: bring details back from a reference or another version (layer move/scale/rotate, brush with size/hardness/flow, Photoshop-like blend modes); saved as `_fix_N` or in place.
- Customizable **keyboard shortcuts** (layout independent).
