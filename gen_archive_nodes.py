"""GenArchive nodes: Registry (records generations + their references) and Container (reloads them)."""
import copy
import glob
import hashlib
import json
import os
import shutil
import time

import numpy as np
import torch
from PIL import Image, ImageOps
from PIL.PngImagePlugin import PngInfo

import folder_paths

from .gen_archive_store import (
    LOCK, MAX_REFS, ROOT_NAME, safe_name, session_dir, registry_path,
    load_registry, save_registry, new_gen_id, next_regen_id, category_ids,
)

try:
    from comfy.cli_args import args as _comfy_args
    _DISABLE_META = bool(getattr(_comfy_args, "disable_metadata", False))
except Exception:
    _DISABLE_META = False

TAG = "[GenArchive]"
_IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif")
_DIR_KEYS = ("path", "folder_path", "directory", "folder", "dir", "input_dir", "image_folder")


# ───────────────────────────── helpers ──────────────────────────────

def _lines(v):
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        v = "\n".join(str(x) for x in v)
    return [l.strip() for l in str(v).replace("\r", "").split("\n") if l.strip()]


def _pick(lines, i, n):
    """Pick the line for item i of n. A single line applies to all items."""
    if not lines:
        return None
    if len(lines) == n:
        return lines[i]
    if len(lines) == 1:
        return lines[0]
    return lines[i % len(lines)]


def _to_uint8(t):
    return (255.0 * t.detach().cpu().numpy()).clip(0, 255).astype(np.uint8)


def _to_pil(arr):
    if arr.ndim == 2:
        return Image.fromarray(arr, "L")
    c = arr.shape[-1]
    if c == 1:
        return Image.fromarray(arr[..., 0], "L")
    if c == 4:
        return Image.fromarray(arr, "RGBA")
    return Image.fromarray(arr[..., :3], "RGB")


def _hash_file(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _file_stem(name, default="ref"):
    stem = os.path.splitext(os.path.basename(str(name or "")))[0]
    return safe_name(stem, default)[:60]


# ──────────────── locating the original reference file ─────────────────

def _is_link(v):
    return isinstance(v, list) and len(v) == 2 and isinstance(v[1], int)


def _upstream_node(prompt, unique_id, input_name):
    """The node connected to input_name (looks through Reroute nodes)."""
    if not prompt or unique_id is None:
        return None
    node = prompt.get(str(unique_id))
    if not node:
        return None
    link = (node.get("inputs") or {}).get(input_name)
    hops = 0
    while _is_link(link) and hops < 6:
        src = prompt.get(str(link[0]))
        if not src:
            return None
        if "reroute" in str(src.get("class_type", "")).lower():
            nxt = None
            for v in (src.get("inputs") or {}).values():
                if _is_link(v):
                    nxt = v
                    break
            if nxt is None:
                return src
            link = nxt
            hops += 1
            continue
        return src
    return None


# --- safety: which files may be copied into the archive -------------------------------------------
# A workflow must not be able to make this node copy arbitrary files (keys, configs...) into the archive.
# A path is trusted only if it is a REAL IMAGE and lies inside ComfyUI's own input/output/temp folders or inside a
# folder that YOU list in the environment variable GENARCHIVE_TRUSTED_FOLDERS (separated by ';' on Windows, ':' elsewhere).
# Folders merely configured on a loader node in the workflow are NOT trusted - a workflow must not decide what is
# readable. Anything else falls back to storing the image that came through the loader pin.
_warned = set()


def _extra_trusted():
    """Extra folders trusted by the person who runs ComfyUI (environment variable, not changeable by a workflow)."""
    raw = os.environ.get("GENARCHIVE_TRUSTED_FOLDERS", "")
    out = []
    for s in raw.split(os.pathsep):
        s = s.strip().strip('"')
        if s and os.path.isdir(s):
            out.append(s)
    return out


def _hint_untrusted(folder):
    if folder in _warned:
        return
    _warned.add(folder)
    print(f"{TAG} Note: '{folder}' is not a trusted folder, so a copy of the image from the loader is stored "
          f"instead of the original file. To use the original files from there, set the environment variable "
          f"GENARCHIVE_TRUSTED_FOLDERS=<folder> before starting ComfyUI.")
_MAX_REF_BYTES = 512 * 1024 * 1024
_valid_cache = {}


def _within(path, root):
    """True if `path` really lies inside the folder `root` (symlinks and '..' are resolved)."""
    try:
        r = os.path.realpath(root)
        return os.path.commonpath([os.path.realpath(path), r]) == r
    except (ValueError, OSError):   # e.g. a different drive on Windows
        return False


def _is_image_file(path):
    """A real image file of a sane size (never a key, a config or any other file)."""
    try:
        if not path.lower().endswith(_IMG_EXTS) or not os.path.isfile(path):
            return False
        st = os.stat(path)
        if st.st_size > _MAX_REF_BYTES:
            return False
        key = (path, st.st_mtime_ns, st.st_size)
        if key not in _valid_cache:
            with Image.open(path) as im:
                im.verify()
            if len(_valid_cache) > 5000:
                _valid_cache.clear()
            _valid_cache[key] = True
        return True
    except Exception:
        return False


def _safe_join(sdir, rel):
    """Archive-relative path -> absolute path, or None if it would leave the session folder."""
    p = os.path.join(sdir, rel or "")
    return p if _within(p, sdir) else None


def _try_file(d, name):
    """Find `name` (also without its extension) inside the folder `d`. Never leaves the folder."""
    p = os.path.join(d, name)
    cands = [p]
    if not os.path.splitext(name)[1]:
        cands += [p + ext for ext in _IMG_EXTS]
    cands += sorted(glob.glob(glob.escape(p) + ".*"))
    for c in cands:
        if _within(c, d) and _is_image_file(c):
            return os.path.abspath(c)
    return None



def _resolve_path(prompt, unique_id, img_input, name_input, name):
    """Finds the full path of the reference file, or None (then the image from the loader pin is stored).

    Only trusted paths are returned: a real image inside ComfyUI's input/output/temp folders or inside a folder
    listed in GENARCHIVE_TRUSTED_FOLDERS (see the safety notes above)."""
    try:
        nodes = []
        for key in (img_input, name_input):
            n = _upstream_node(prompt, unique_id, key)
            if n is not None and n not in nodes:
                nodes.append(n)

        in_dir = folder_paths.get_input_directory()
        roots = [in_dir, folder_paths.get_output_directory(), folder_paths.get_temp_directory()]
        loader_dirs = []   # folders configured on the connected loader node(s)
        for n in nodes:
            inputs = n.get("inputs") or {}
            for k in _DIR_KEYS:
                v = inputs.get(k)
                if isinstance(v, str) and v.strip():
                    v = v.strip()
                    for cand in (v, os.path.join(in_dir, v)):
                        if os.path.isdir(cand) and cand not in loader_dirs:
                            loader_dirs.append(cand)
        allowed = roots + _extra_trusted()

        def trusted(p):
            return bool(p) and any(_within(p, r) for r in allowed) and _is_image_file(p)

        for n in nodes:   # LoadImage and similar
            img = (n.get("inputs") or {}).get("image")
            if isinstance(img, str):
                try:
                    p = folder_paths.get_annotated_filepath(img)
                except Exception:
                    p = None
                if trusted(p):
                    return os.path.abspath(p)
        if name:
            if os.path.isabs(name):   # e.g. the file_paths output of a batch loader
                if trusted(name):
                    return os.path.abspath(name)
                if os.path.isfile(name):
                    _hint_untrusted(os.path.dirname(os.path.abspath(name)))
            else:                     # e.g. filename_text of WAS Load Image Batch
                for d in loader_dirs:
                    if any(_within(d, r) for r in allowed):   # the loader's folder must itself be a trusted folder
                        p = _try_file(d, name)
                        if p:
                            return p
                    elif _try_file(d, name):
                        _hint_untrusted(os.path.abspath(d))
    except Exception as e:
        print(f"{TAG} Could not resolve reference path: {e}")
    return None


# ───────────────────────── storing references ──────────────────────

_ref_cache = {}


def _store_ref(sdir, slot, src_path, tensor, name_hint):
    sub = f"Ref_{slot}"
    os.makedirs(os.path.join(sdir, sub), exist_ok=True)
    if src_path:
        st = os.stat(src_path)
        key = (sdir, slot, src_path, st.st_mtime_ns, st.st_size)
        cached = _ref_cache.get(key)
        if cached and os.path.isfile(os.path.join(sdir, cached["file"])):
            return dict(cached)
        h = _hash_file(src_path)[:10]
        ext = os.path.splitext(src_path)[1].lower() or ".png"
        fname = f"{_file_stem(src_path)}__{h}{ext}"
        dest = os.path.join(sdir, sub, fname)
        if not os.path.isfile(dest):
            shutil.copy2(src_path, dest)
        info = {
            "file": f"{sub}/{fname}",
            "orig_path": src_path,
            "orig_name": os.path.basename(src_path),
            "from_tensor": False,
        }
        _ref_cache[key] = info
        return dict(info)

    arr = _to_uint8(tensor)
    h = hashlib.sha1(arr.tobytes()).hexdigest()[:10]
    fname = f"{_file_stem(name_hint)}__{h}.png"
    dest = os.path.join(sdir, sub, fname)
    if not os.path.isfile(dest):
        _to_pil(arr).save(dest, compress_level=3)
    return {
        "file": f"{sub}/{fname}",
        "orig_path": None,
        "orig_name": os.path.basename(name_hint) if name_hint else None,
        "from_tensor": True,
    }


# ─────────────────────────────── Registry ─────────────────────────────

def _find_container_ids(prompt, unique_id):
    """Look upstream of this node for an Archive Container and work out which archive
    image(s) it is loading in this run. Returns (session, [ids]) or None."""
    try:
        if not prompt or unique_id is None:
            return None
        start = prompt.get(str(unique_id))
        if not start:
            return None
        stack = [str(v[0]) for v in (start.get("inputs") or {}).values() if _is_link(v)]
        seen, found = set(), []
        while stack:
            nid = stack.pop()
            if nid in seen:
                continue
            seen.add(nid)
            node = prompt.get(nid)
            if not node:
                continue
            if node.get("class_type") == "GenArchiveContainer":
                found.append(node)
                continue
            stack.extend(str(v[0]) for v in (node.get("inputs") or {}).values() if _is_link(v))
        results = []
        for node in found:
            inp = node.get("inputs") or {}
            sess, cat, idx, mode = inp.get("session"), inp.get("category"), inp.get("index"), inp.get("mode")
            if not (isinstance(sess, str) and isinstance(cat, str) and isinstance(idx, int) and isinstance(mode, str)):
                print(f"{TAG} Warning: a container's inputs are linked/converted, cannot auto-detect regeneration.")
                continue
            sess = safe_name(sess)
            with LOCK:
                data = load_registry(sess)
            ids = category_ids(data, cat)
            if not ids:
                continue
            results.append((sess, [ids[idx % len(ids)]] if mode == "one_by_index" else ids))
        if not results:
            return None
        if any(r != results[0] for r in results[1:]):
            print(f"{TAG} Warning: several different Archive Containers feed this workflow - "
                  f"cannot auto-detect regeneration (connect regen_id manually).")
            return None
        return results[0]
    except Exception as e:
        print(f"{TAG} Could not auto-detect an Archive Container: {e}")
        return None


class GenArchiveRegistry:
    CATEGORY = "GenArchive"
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "gen_ids")
    FUNCTION = "register"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        optional = {}
        for k in range(1, MAX_REFS + 1):
            optional[f"ref_{k}"] = ("IMAGE", {
                "label": f"ref_{k} (reference)",
                "tooltip": "Branch from a reference loader (a side connection, not a pass-through).",
            })
        for k in range(1, MAX_REFS + 1):
            optional[f"path_{k}"] = ("STRING", {
                "forceInput": True,
                "tooltip": "Optional: file path / file name of the reference (CRT: file_paths, WAS: filename_text). "
                           "Only real image files inside ComfyUI's input/output/temp folders (or folders listed in "
                           "GENARCHIVE_TRUSTED_FOLDERS) are used; otherwise the loader's image is stored.",
            })
        optional["regen_of"] = ("STRING", {
            "forceInput": True,
            "tooltip": "Optional. Regeneration is detected automatically when an Archive Container feeds "
                       "this workflow (the result is saved as gen_0007_reg_1 and inherits the original's "
                       "references). Connect regen_id here only to override that.",
        })
        optional["info"] = ("STRING", {
            "forceInput": True,
            "tooltip": "Optional: any text (seed, prompt...) to show in the viewer.",
        })
        return {
            "required": {
                "images": ("IMAGE", {
                    "label": "images (result)",
                    "tooltip": "The generated images (e.g. the output of VAE Decode).",
                }),
                "session": ("STRING", {
                    "default": "session_01",
                    "tooltip": "Session name = folder in output/GenArchive. Change it to start a new session.",
                }),
                "save_format": (["png", "jpg"],),
            },
            "optional": optional,
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO", "unique_id": "UNIQUE_ID"},
        }

    def register(self, images, session, save_format, prompt=None, extra_pnginfo=None,
                 unique_id=None, regen_of=None, info=None, **kw):
        session = safe_name(session)
        n = int(images.shape[0])
        ext = "jpg" if save_format == "jpg" else "png"

        ref_in = {}
        for k in range(1, MAX_REFS + 1):
            t = kw.get(f"ref_{k}")
            if t is not None:
                ref_in[k] = (t, _lines(kw.get(f"path_{k}")))

        regen_lines = _lines(regen_of)
        if not regen_lines:  # no regen_of connected: detect an Archive Container upstream automatically
            auto = _find_container_ids(prompt, unique_id)
            if auto:
                csession, regen_lines = auto
                if csession != session:
                    print(f"{TAG} Using the container's session '{csession}' instead of '{session}'.")
                    session = csession
                print(f"{TAG} Archive Container detected upstream -> regenerating {', '.join(regen_lines)}")
        if info is not None and str(info).strip():
            info_lines = _lines(info) if n > 1 else [str(info).strip()]
        else:
            info_lines = []

        meta = None
        if ext == "png" and not _DISABLE_META:
            meta = PngInfo()
            if prompt is not None:
                meta.add_text("prompt", json.dumps(prompt))
            if extra_pnginfo is not None:
                for key in extra_pnginfo:
                    meta.add_text(key, json.dumps(extra_pnginfo[key]))

        out_ids = []
        with LOCK:
            sdir = session_dir(session, create=True)
            out_dir = os.path.join(sdir, "Output")
            os.makedirs(out_dir, exist_ok=True)
            data = load_registry(session)

            if not ref_in and not regen_lines:
                print(f"{TAG} Warning: no ref_N input is connected - references will not be recorded.")

            for i in range(n):
                src_id = _pick(regen_lines, i, n) if regen_lines else None
                src = data["entries"].get(src_id) if src_id else None
                if src_id and src is None:
                    print(f"{TAG} Warning: '{src_id}' was not found in session '{session}' - "
                          f"registering as a new generation. "
                          f"(The session name must match the Container's session.)")

                refs = {}
                if src is not None:
                    base, rn, gid = next_regen_id(data, src_id)
                    refs = copy.deepcopy(src.get("refs", {}))
                else:
                    gid = new_gen_id(data)
                    base, rn = gid, 0
                    for k, (t, names) in ref_in.items():
                        b = int(t.shape[0])
                        j = i if b == n else (0 if b == 1 else i % b)
                        nm = _pick(names, j, b)
                        path = _resolve_path(prompt, unique_id, f"ref_{k}", f"path_{k}", nm)
                        refs[f"ref_{k}"] = _store_ref(sdir, k, path, t[j], nm)

                arr = _to_uint8(images[i])
                pil = _to_pil(arr)
                fname = f"{gid}.{ext}"
                fpath = os.path.join(out_dir, fname)
                if ext == "jpg":
                    pil.convert("RGB").save(fpath, quality=95, subsampling=0)
                else:
                    pil.save(fpath, pnginfo=meta, compress_level=4)

                data["entries"][gid] = {
                    "id": gid,
                    "base": base,
                    "regen": rn,
                    "regen_of": src_id if src is not None else None,
                    "file": f"Output/{fname}",
                    "refs": refs,
                    "info": _pick(info_lines, i, n) or "",
                    "time": time.time(),
                    "w": int(arr.shape[1]),
                    "h": int(arr.shape[0]),
                }
                out_ids.append(gid)
                names_dbg = ", ".join(f"{k}={v.get('orig_name') or v['file']}" for k, v in refs.items())
                print(f"{TAG} {gid} <- {names_dbg or 'no references'}")

            save_registry(session, data)

        previews = [{"filename": f"{g}.{ext}", "subfolder": f"{ROOT_NAME}/{session}/Output", "type": "output"}
                    for g in out_ids[-6:]]
        return {"ui": {"images": previews}, "result": (images, "\n".join(out_ids))}


# ─────────────────────────────── Container ────────────────────────────

def _blank():
    return torch.zeros((1, 64, 64, 3), dtype=torch.float32)


def _load_tensor(path, megapixels=0.0):
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        if megapixels and megapixels > 0:
            w, h = im.size
            s = (megapixels * 1_000_000 / (w * h)) ** 0.5
            nw, nh = max(8, round(w * s / 8) * 8), max(8, round(h * s / 8) * 8)
            if (nw, nh) != (w, h):
                im = im.resize((nw, nh), Image.LANCZOS)
        arr = np.array(im).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _stack(tensors):
    """Concatenate into a batch; differently sized images are resized to the first one."""
    if len(tensors) == 1:
        return tensors[0]
    _, h, w, _ = tensors[0].shape
    out = []
    for t in tensors:
        if t.shape[1] != h or t.shape[2] != w:
            im = Image.fromarray(_to_uint8(t[0])).resize((w, h), Image.LANCZOS)
            t = torch.from_numpy(np.array(im).astype(np.float32) / 255.0).unsqueeze(0)
        out.append(t)
    return torch.cat(out, dim=0)


class GenArchiveContainer:
    CATEGORY = "GenArchive"
    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "STRING", "STRING", "INT")
    RETURN_NAMES = ("ref_1", "ref_2", "ref_3", "ref_4", "original_result", "regen_id", "ref_info", "count")
    FUNCTION = "load"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "session": ("STRING", {"default": "session_01"}),
                "category": ("STRING", {"default": "", "tooltip": "Name of a category created in the viewer."}),
                "index": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF, "control_after_generate": True,
                                  "tooltip": "Which item of the category to load (wraps around). "
                                             "Increments after every run."}),
                "mode": (["one_by_index", "all_as_batch"],),
                "megapixels": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 16.0, "step": 0.05,
                                         "tooltip": "0 = keep the original reference size."}),
            }
        }

    @classmethod
    def IS_CHANGED(cls, session, category, index, mode, megapixels):
        try:
            m = os.stat(registry_path(session)).st_mtime_ns
        except OSError:
            m = 0
        return f"{m}:{category}:{index}:{mode}:{megapixels}"

    def load(self, session, category, index, mode, megapixels):
        session = safe_name(session)
        with LOCK:
            data = load_registry(session)
        ids = category_ids(data, category)
        if not ids:
            raise ValueError(f"{TAG} Category '{category}' in session '{session}' is empty or does not exist.")
        sel = [ids[index % len(ids)]] if mode == "one_by_index" else ids
        sdir = session_dir(session)

        refs = {k: [] for k in range(1, MAX_REFS + 1)}
        results, info_lines = [], []
        for gid in sel:
            e = data["entries"][gid]
            parts = []
            for k in range(1, MAX_REFS + 1):
                r = (e.get("refs") or {}).get(f"ref_{k}")
                t = None
                if r:
                    p = _safe_join(sdir, r["file"])
                    if p and os.path.isfile(p):
                        t = _load_tensor(p, megapixels)
                        parts.append(f"ref_{k}={r.get('orig_name') or os.path.basename(r['file'])}")
                    else:
                        print(f"{TAG} Reference file not found: {p}")
                refs[k].append(t if t is not None else _blank())
            p = _safe_join(sdir, e["file"])
            results.append(_load_tensor(p) if p and os.path.isfile(p) else _blank())
            info_lines.append(f"{gid}: " + ", ".join(parts))

        if mode == "one_by_index":
            print(f"{TAG} container '{category}': {ids.index(sel[0]) + 1}/{len(ids)} -> {sel[0]}")
        return (
            _stack(refs[1]), _stack(refs[2]), _stack(refs[3]), _stack(refs[4]),
            _stack(results), "\n".join(sel), "\n".join(info_lines), len(ids),
        )


NODE_CLASS_MAPPINGS = {
    "GenArchiveRegistry": GenArchiveRegistry,
    "GenArchiveContainer": GenArchiveContainer,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "GenArchiveRegistry": "Generation Archive",
    "GenArchiveContainer": "Archive Container",
}
