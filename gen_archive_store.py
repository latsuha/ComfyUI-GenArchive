"""GenArchive storage: session folders, registry.json, categories.

Layout on disk (everything lives in ComfyUI/output/GenArchive/<session>/):
    Output/        generated results (gen_0001.png, gen_0001_regen1.png ...)
    Ref_1/ Ref_2/  copies of reference images (de-duplicated by content)
    Categories/    optional export of categories
    registry.json  all metadata: entries, references, categories
"""
import json
import os
import re
import shutil
import threading
import time

import folder_paths

ROOT_NAME = "GenArchive"
REGISTRY_FILE = "registry.json"
MAX_REFS = 4
LOCK = threading.RLock()

_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
# <base>[_reg_N][_color_M | _fix_M]   (also understands the legacy "_regenN")
_ID_RE = re.compile(r"^(?P<base>.+?)(?:_reg(?:en)?_?(?P<r>\d+))?(?:_(?P<tag>color|fix)_(?P<c>\d+))?$")
_GEN_RE = re.compile(r"^gen_(\d+)$")


def safe_name(name, default="session_01"):
    s = _ILLEGAL.sub("_", str(name or "")).strip(" .")
    return s[:80] or default


def archive_root():
    return os.path.join(folder_paths.get_output_directory(), ROOT_NAME)


def session_dir(session, create=False):
    d = os.path.join(archive_root(), safe_name(session))
    if create:
        os.makedirs(d, exist_ok=True)
    return d


def registry_path(session):
    return os.path.join(session_dir(session), REGISTRY_FILE)


def _empty(session):
    return {
        "version": 1,
        "session": safe_name(session),
        "created": time.time(),
        "counter": 0,
        "entries": {},
        "categories": {},
    }


def load_registry(session):
    p = registry_path(session)
    for cand in (p, p + ".bak"):
        if os.path.isfile(cand):
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and isinstance(data.get("entries"), dict):
                    data.setdefault("categories", {})
                    data.setdefault("counter", 0)
                    return data
            except Exception as e:  # corrupted file -> try the .bak copy
                print(f"[GenArchive] Could not read {cand}: {e}")
    return _empty(session)


def save_registry(session, data):
    session_dir(session, create=True)
    p = registry_path(session)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    if os.path.isfile(p):
        try:
            shutil.copy2(p, p + ".bak")
        except OSError:
            pass
    os.replace(tmp, p)


def parse_id(gid):
    """'gen_0007_reg_1_fix_2' -> ('gen_0007', 1, 'fix', 2)"""
    m = _ID_RE.match(gid)
    return m.group("base"), int(m.group("r") or 0), m.group("tag") or "", int(m.group("c") or 0)


def split_id(gid):
    base, r, _, _ = parse_id(gid)
    return base, r


_TAG_RANK = {"": 0, "color": 1, "fix": 2}


def sort_key(gid):
    base, r, tag, c = parse_id(gid)
    m = _GEN_RE.match(base)
    return (int(m.group(1)) if m else 10 ** 12, base, r, _TAG_RANK[tag], c)


def sorted_entries(data):
    return sorted(data["entries"].values(), key=lambda e: sort_key(e["id"]))


def find_category(data, name):
    cats = data.get("categories", {})
    if name in cats:
        return name
    low = (name or "").strip().casefold()
    for k in cats:
        if k.casefold() == low:
            return k
    return None


def category_ids(data, name):
    key = find_category(data, name)
    if key is None:
        return []
    ids = [i for i in data["categories"][key] if i in data["entries"]]
    return sorted(ids, key=sort_key)


def new_gen_id(data):
    biggest = data.get("counter", 0)
    for k in data["entries"]:
        m = _GEN_RE.match(split_id(k)[0])
        if m:
            biggest = max(biggest, int(m.group(1)))
    data["counter"] = biggest + 1
    return f"gen_{data['counter']:04d}"


def next_regen_id(data, source_id):
    src = data["entries"].get(source_id, {})
    base = src.get("base") or split_id(source_id)[0]
    existing = [e.get("regen", 0) for e in data["entries"].values() if e.get("base") == base]
    n = max(existing + [0]) + 1
    return base, n, f"{base}_reg_{n}"


def next_variant_id(data, source_id, tag):
    """Id for an edited copy: <source without _color_N/_fix_N>_<tag>_<n>."""
    root = re.sub(r"_(?:color|fix)_\d+$", "", source_id)
    pat = re.compile("^" + re.escape(root) + "_" + tag + r"_(\d+)$")
    nums = [int(m.group(1)) for k in data["entries"] for m in [pat.match(k)] if m]
    n = max(nums + [0]) + 1
    return n, f"{root}_{tag}_{n}"


def next_color_id(data, source_id):
    return next_variant_id(data, source_id, "color")
