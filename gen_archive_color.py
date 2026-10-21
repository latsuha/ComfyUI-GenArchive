"""Light colour / detail adjustments.

The same function is used for the viewer's live preview and for the final
"Apply", so what you see is exactly what gets saved.

Pipeline (0 = neutral, except gamma = 1 and grain_size = 1):
    exposure -> warmth -> R/G/B channels -> contrast -> gamma -> vibrance
    -> saturation -> sharpness -> grain / colour noise
"""
import numpy as np
from PIL import Image, ImageFilter

DEFAULTS = {
    "exposure": 0.0,      # EV stops
    "contrast": 0.0,      # -100 .. 100
    "gamma": 1.0,         # 0.4 .. 2.5 (>1 brightens midtones)
    "saturation": 0.0,    # -100 .. 100
    "vibrance": 0.0,      # -100 .. 100 (boosts muted colours more, protects skin tones)
    "temperature": 0.0,   # -100 (cool) .. 100 (warm)
    "red": 0.0,           # -100 .. 100 (channel gain)
    "green": 0.0,
    "blue": 0.0,
    "sharpness": 0.0,     # -100 (soften) .. 100 (sharpen)
    "grain": 0.0,         # 0 .. 100 (luminance film grain, strongest in midtones)
    "grain_size": 1.0,    # 1 .. 6 (only matters when grain > 0)
    "noise": 0.0,         # 0 .. 100 (per-channel colour noise)
}
LIMITS = {
    "exposure": (-3.0, 3.0),
    "contrast": (-100.0, 100.0),
    "gamma": (0.4, 2.5),
    "saturation": (-100.0, 100.0),
    "vibrance": (-100.0, 100.0),
    "temperature": (-100.0, 100.0),
    "red": (-100.0, 100.0),
    "green": (-100.0, 100.0),
    "blue": (-100.0, 100.0),
    "sharpness": (-100.0, 100.0),
    "grain": (0.0, 100.0),
    "grain_size": (1.0, 6.0),
    "noise": (0.0, 100.0),
}
_EPS = 1e-6
_NO_NEUTRAL_CHECK = ("grain_size",)   # a lone size change does nothing
_SEED = 20240611                      # fixed so the grain does not "boil" while dragging sliders


def clean_params(d):
    out = {}
    for k, default in DEFAULTS.items():
        try:
            v = float((d or {}).get(k, default))
        except (TypeError, ValueError):
            v = default
        if v != v:  # NaN
            v = default
        lo, hi = LIMITS[k]
        out[k] = min(hi, max(lo, v))
    return out


def is_neutral(p):
    return all(abs(p[k] - DEFAULTS[k]) < _EPS for k in DEFAULTS if k not in _NO_NEUTRAL_CHECK)


def _lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def _vibrance(a, v):
    """Photoshop-style: low-saturation colours are boosted more; warm skin hues are protected."""
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    s = (mx - mn) / (mx + 1e-4)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    t = (g - b) / (r - b + 1e-4)
    skin = np.where((r >= g) & (g >= b), 4.0 * t * (1.0 - t), 0.0).clip(0.0, 1.0)
    if v > 0:
        w = 1.0 + v * (1.0 - s) * (1.0 - 0.4 * skin)
    else:
        w = 1.0 + v * (0.3 + 0.7 * s)
    lum = _lum(a)[..., None]
    return np.clip(lum + (a - lum) * w[..., None], 0.0, 1.0)


def adjust(im, params):
    """Returns a new RGB (or RGBA) PIL image; the input is never modified."""
    p = clean_params(params)
    alpha = im.getchannel("A") if im.mode in ("RGBA", "LA") else None
    rgb = im.convert("RGB")

    tone_keys = ("exposure", "contrast", "gamma", "saturation", "vibrance", "temperature", "red", "green", "blue")
    if any(abs(p[k] - DEFAULTS[k]) > _EPS for k in tone_keys):
        a = np.asarray(rgb, dtype=np.float32) / 255.0
        if abs(p["exposure"]) > _EPS:
            # 2^(EV/2.2) in display space == multiplying linear light by 2^EV
            a = np.clip(a * (2.0 ** (p["exposure"] / 2.2)), 0.0, 1.0)
        if abs(p["temperature"]) > _EPS:
            k = p["temperature"] / 100.0
            a[..., 0] *= 1.0 + 0.25 * k
            a[..., 2] *= 1.0 - 0.25 * k
            np.clip(a, 0.0, 1.0, out=a)
        if any(abs(p[c]) > _EPS for c in ("red", "green", "blue")):
            gains = np.array([1.0 + 0.35 * p[c] / 100.0 for c in ("red", "green", "blue")], dtype=np.float32)
            a = np.clip(a * gains, 0.0, 1.0)
        if abs(p["contrast"]) > _EPS:
            a = np.clip((a - 0.5) * (1.0 + p["contrast"] / 100.0) + 0.5, 0.0, 1.0)
        if abs(p["gamma"] - 1.0) > _EPS:
            a = np.power(a, 1.0 / p["gamma"])
        if abs(p["vibrance"]) > _EPS:
            a = _vibrance(a, p["vibrance"] / 100.0)
        if abs(p["saturation"]) > _EPS:
            lum = _lum(a)[..., None]
            a = np.clip(lum + (a - lum) * (1.0 + p["saturation"] / 100.0), 0.0, 1.0)
        rgb = Image.fromarray((a * 255.0 + 0.5).astype(np.uint8), "RGB")

    s = p["sharpness"]
    if abs(s) > _EPS:
        # radius scales with the image so the preview (downscaled) matches the full-size result
        radius = max(0.6, max(rgb.size) * 0.0006)
        if s > 0:
            rgb = rgb.filter(ImageFilter.UnsharpMask(radius=radius, percent=int(s * 2), threshold=0))
        else:
            rgb = Image.blend(rgb, rgb.filter(ImageFilter.GaussianBlur(radius)), min(1.0, -s / 100.0))

    if p["grain"] > _EPS or p["noise"] > _EPS:
        a = np.asarray(rgb, dtype=np.float32) / 255.0
        h, w = a.shape[:2]
        rng = np.random.default_rng(_SEED)
        if p["grain"] > _EPS:
            # grain size is relative to the image (2000px long side == 1x) so previews match the result
            size = max(1.0, p["grain_size"] * max(w, h) / 2000.0)
            gh, gw = max(1, int(round(h / size))), max(1, int(round(w / size)))
            n = rng.standard_normal((gh, gw), dtype=np.float32)
            if (gh, gw) != (h, w):
                n = np.array(Image.fromarray(n).resize((w, h), Image.BICUBIC), dtype=np.float32)
                n /= max(float(n.std()), 1e-6)   # keep the strength independent of the grain size
            lum = _lum(a)
            weight = 0.35 + 0.65 * 4.0 * lum * (1.0 - lum)   # film-like: strongest in the midtones
            a += (n * weight)[..., None] * (p["grain"] / 100.0 * 0.12)
        if p["noise"] > _EPS:
            a += rng.standard_normal(a.shape, dtype=np.float32) * (p["noise"] / 100.0 * 0.08)
        rgb = Image.fromarray((np.clip(a, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8), "RGB")

    if alpha is not None:
        rgb.putalpha(alpha)
    return rgb
