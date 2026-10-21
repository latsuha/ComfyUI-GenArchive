"""HTTP routes for the GenArchive viewer (served by the ComfyUI server)."""
import asyncio
import copy
import io
import json
import os
import shutil
import subprocess
import sys
import time

from aiohttp import web
from PIL import Image, ImageOps
from PIL.PngImagePlugin import PngInfo
from server import PromptServer

from . import gen_archive_color as color
from . import gen_archive_store as st

routes = PromptServer.instance.routes
_RESAMPLE = getattr(getattr(Image, "Resampling", Image), "LANCZOS")


def _session(request):
    return st.safe_name(request.query.get("session") or request.query.get("name"))


def _rev(session):
    try:
        return str(os.stat(st.registry_path(session)).st_mtime_ns)
    except OSError:
        return "0"


@routes.get("/gen_archive/sessions")
async def api_sessions(request):
    root = st.archive_root()
    out = []
    if os.path.isdir(root):
        for name in os.listdir(root):
            p = os.path.join(root, name, st.REGISTRY_FILE)
            if os.path.isfile(p):
                try:
                    data = st.load_registry(name)
                    out.append({"name": name, "count": len(data["entries"]), "mtime": os.path.getmtime(p)})
                except Exception:
                    pass
    out.sort(key=lambda x: -x["mtime"])
    return web.json_response({"sessions": out})


@routes.get("/gen_archive/session")
async def api_session(request):
    s = _session(request)
    with st.LOCK:
        data = st.load_registry(s)
    return web.json_response({
        "session": s,
        "rev": _rev(s),
        "entries": st.sorted_entries(data),
        "categories": data["categories"],
    })


def _make_thumb(src, dst, size):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with Image.open(src) as im:
        try:
            im.draft("RGB", (size * 2, size * 2))
        except Exception:
            pass
        im = ImageOps.exif_transpose(im)
        im.thumbnail((size, size), _RESAMPLE)
        if im.mode in ("RGBA", "LA", "P"):
            rgba = im.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (24, 26, 30))
            bg.paste(rgba, mask=rgba.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        tmp = dst + ".tmp"
        im.save(tmp, "JPEG", quality=85)
    os.replace(tmp, dst)


@routes.get("/gen_archive/file")
async def api_file(request):
    s = _session(request)
    rel = request.query.get("path", "")
    sdir = os.path.realpath(st.session_dir(s))
    full = os.path.realpath(os.path.join(sdir, rel))
    if not full.startswith(sdir + os.sep):
        return web.Response(status=403, text="forbidden")
    if not os.path.isfile(full):
        return web.Response(status=404, text="not found")
    try:
        thumb = int(request.query.get("thumb", "0") or 0)
    except ValueError:
        thumb = 0
    if thumb > 0:
        thumb = min(max(thumb, 64), 1024)
        tname = rel.replace("/", "__").replace("\\", "__") + f"_{thumb}.jpg"
        tpath = os.path.join(sdir, ".thumbs", tname)
        if not os.path.isfile(tpath) or os.path.getmtime(tpath) < os.path.getmtime(full):
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, _make_thumb, full, tpath, thumb)
            except Exception as e:
                print(f"[GenArchive] thumb error: {e}")
                tpath = full
        full = tpath
    return web.FileResponse(full, headers={"Cache-Control": "public, max-age=3600"})


def _export_category(s, data, cat):
    sdir = st.session_dir(s)
    key = st.find_category(data, cat) or cat
    out_dir = os.path.join(sdir, "Categories", st.safe_name(key, "category"))
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for gid in st.category_ids(data, key):
        e = data["entries"][gid]
        src = os.path.join(sdir, e["file"])
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(out_dir, f"{gid}{os.path.splitext(src)[1]}"))
            n += 1
        for slot, r in (e.get("refs") or {}).items():
            rp = os.path.join(sdir, r["file"])
            if os.path.isfile(rp):
                nm = st.safe_name(r.get("orig_name") or os.path.basename(r["file"]), "ref")
                shutil.copy2(rp, os.path.join(out_dir, f"{gid}__{slot}__{nm}"))
    return f"Categories/{st.safe_name(key, 'category')}", n


@routes.post("/gen_archive/categories")
async def api_categories(request):
    body = await request.json()
    s = st.safe_name(body.get("session"))
    action = body.get("action")
    cat = str(body.get("category") or "").strip()[:60]
    ids = [i for i in (body.get("ids") or []) if isinstance(i, str)]
    extra = {}
    with st.LOCK:
        data = st.load_registry(s)
        cats = data["categories"]
        valid = [i for i in ids if i in data["entries"]]
        key = st.find_category(data, cat) or cat
        changed = True

        if action in ("create", "add"):
            if not cat:
                return web.json_response({"error": "empty category"}, status=400)
            lst = cats.setdefault(key, [])
            for i in valid:
                if i not in lst:
                    lst.append(i)
        elif action == "remove":
            drop = set(valid)
            if key in cats:
                cats[key] = [i for i in cats[key] if i not in drop]
        elif action == "delete":
            cats.pop(key, None)
        elif action == "rename":
            new = str(body.get("new_name") or "").strip()[:60]
            if not new or key not in cats:
                return web.json_response({"error": "bad rename"}, status=400)
            rebuilt = {}
            for k, v in cats.items():
                if k == key:
                    merged = rebuilt.setdefault(new, [])
                    merged.extend(i for i in v if i not in merged)
                elif k == new:
                    merged = rebuilt.setdefault(new, [])
                    merged.extend(i for i in v if i not in merged)
                else:
                    rebuilt[k] = v
            data["categories"] = cats = rebuilt
        elif action == "remove_regenerated":
            done = {e.get("regen_of") for e in data["entries"].values() if e.get("regen_of")}
            if key in cats:
                before = len(cats[key])
                cats[key] = [i for i in cats[key] if i not in done]
                extra["removed"] = before - len(cats[key])
        elif action == "export":
            changed = False
            extra["path"], extra["count"] = _export_category(s, data, cat)
        else:
            return web.json_response({"error": "unknown action"}, status=400)

        if changed:
            st.save_registry(s, data)
    return web.json_response({"ok": True, "categories": data["categories"], "rev": _rev(s), **extra})


def _inside(sdir, rel):
    full = os.path.realpath(os.path.join(sdir, rel))
    return full if full.startswith(sdir + os.sep) else None


def _remove_with_thumbs(sdir, rel):
    """Delete a file of the session together with its cached thumbnails."""
    if not rel:
        return
    full = _inside(sdir, rel)
    if full and os.path.isfile(full):
        try:
            os.remove(full)
        except OSError as e:
            print(f"[GenArchive] Could not delete {full}: {e}")
    tdir = os.path.join(sdir, ".thumbs")
    prefix = rel.replace("/", "__").replace("\\", "__") + "_"
    if os.path.isdir(tdir):
        for name in os.listdir(tdir):
            if name.startswith(prefix) and name.endswith(".jpg"):
                try:
                    os.remove(os.path.join(tdir, name))
                except OSError:
                    pass


@routes.post("/gen_archive/delete")
async def api_delete(request):
    """Permanently delete images from the archive (files + registry entries).

    Reference copies are removed only when no remaining image uses them."""
    body = await request.json()
    s = st.safe_name(body.get("session"))
    ids = [i for i in (body.get("ids") or []) if isinstance(i, str)]
    sdir = os.path.realpath(st.session_dir(s))
    deleted = 0
    refs_removed = 0
    with st.LOCK:
        data = st.load_registry(s)
        victims = [i for i in ids if i in data["entries"]]
        if victims:
            candidates = set()
            for gid in victims:
                e = data["entries"].pop(gid)
                _remove_with_thumbs(sdir, e.get("file"))
                _remove_backup(sdir, e.get("file"))
                for r in (e.get("refs") or {}).values():
                    if r.get("file"):
                        candidates.add(r["file"])
                deleted += 1
            gone = set(victims)
            for k in list(data["categories"].keys()):
                data["categories"][k] = [i for i in data["categories"][k] if i not in gone]
            still_used = {r["file"] for e in data["entries"].values()
                          for r in (e.get("refs") or {}).values() if r.get("file")}
            for rel in candidates - still_used:
                _remove_with_thumbs(sdir, rel)
                refs_removed += 1
            st.save_registry(s, data)
    return web.json_response({
        "ok": True, "deleted": deleted, "refs_removed": refs_removed,
        "categories": data["categories"], "rev": _rev(s),
    })


# ───────────────────── colour correction ─────────────────────

def _clear_thumbs(sdir, rel):
    tdir = os.path.join(sdir, ".thumbs")
    prefix = rel.replace("/", "__").replace("\\", "__") + "_"
    if os.path.isdir(tdir):
        for name in os.listdir(tdir):
            if name.startswith(prefix) and name.endswith(".jpg"):
                try:
                    os.remove(os.path.join(tdir, name))
                except OSError:
                    pass


def _backup_path(sdir, rel):
    return os.path.join(sdir, ".orig", os.path.basename(rel))


def _remove_backup(sdir, rel):
    if not rel:
        return
    try:
        os.remove(_backup_path(sdir, rel))
    except OSError:
        pass


_PREVIEW_CACHE = {}


def _preview_bytes(full, params, max_side):
    key = (full, os.stat(full).st_mtime_ns, max_side)
    base = _PREVIEW_CACHE.get(key)
    if base is None:
        with Image.open(full) as im:
            im.load()
            base = im.convert("RGBA" if im.mode in ("RGBA", "LA") else "RGB")
        if max_side and max(base.size) > max_side:
            base.thumbnail((max_side, max_side), _RESAMPLE)
        _PREVIEW_CACHE[key] = base
        while len(_PREVIEW_CACHE) > 3:
            _PREVIEW_CACHE.pop(next(iter(_PREVIEW_CACHE)))
    out = color.adjust(base, params)
    if out.mode == "RGBA":
        bg = Image.new("RGB", out.size, (0, 0, 0))
        bg.paste(out, mask=out.getchannel("A"))
        out = bg
    buf = io.BytesIO()
    out.convert("RGB").save(buf, "JPEG", quality=90)
    return buf.getvalue()


@routes.get("/gen_archive/preview")
async def api_preview(request):
    s = _session(request)
    sdir = os.path.realpath(st.session_dir(s))
    full = _inside(sdir, request.query.get("path", ""))
    if not full or not os.path.isfile(full):
        return web.Response(status=404, text="not found")
    params = color.clean_params({k: request.query.get(k) for k in color.DEFAULTS})
    try:
        max_side = int(request.query.get("max", "2000") or 0)
    except ValueError:
        max_side = 2000
    max_side = max(0, min(max_side, 8192))  # 0 = full size
    try:
        loop = asyncio.get_running_loop()
        body = await loop.run_in_executor(None, _preview_bytes, full, params, max_side)
    except Exception as e:
        return web.Response(status=500, text=str(e))
    return web.Response(body=body, content_type="image/jpeg", headers={"Cache-Control": "private, max-age=600"})


def _save_adjusted(out, text, dest):
    """Save atomically in the format of `dest`, keeping PNG text chunks (ComfyUI prompt/workflow)."""
    ext = os.path.splitext(dest)[1].lower()
    tmp = os.path.join(os.path.dirname(dest), ".tmp_" + os.path.basename(dest))
    if ext in (".jpg", ".jpeg"):
        out.convert("RGB").save(tmp, quality=95, subsampling=0)
    elif ext == ".png":
        meta = PngInfo()
        for k, v in (text or {}).items():
            try:
                meta.add_text(k, v)
            except Exception:
                pass
        out.save(tmp, pnginfo=meta, compress_level=4)
    else:
        out.save(tmp)
    os.replace(tmp, dest)


def _commit_image(data, sdir, e, gid, src, out, text, mode, tag, extra):
    """Write `out` over the image (the very first original is backed up for Revert) or as a new
    <root>_<tag>_N copy next to it. Mutates `data`; the caller saves the registry. Returns the id."""
    now = int(time.time() * 1000)
    if mode == "copy":
        n, nid = st.next_variant_id(data, gid, tag)
        rel = f"Output/{nid}{os.path.splitext(src)[1]}"
        _save_adjusted(out, text, os.path.join(sdir, rel))
        ne = copy.deepcopy(e)
        for t in ("color", "fix"):  # a copy is a variant of ONE kind only
            ne.pop(t, None)
            ne.pop(t + "_of", None)
        ne.pop("color_params", None)
        ne.update({"id": nid, "file": rel, tag: n, tag + "_of": gid, "adjusted": False,
                   "time": time.time(), "v": now})
        ne.update(extra)
        data["entries"][nid] = ne
        return nid
    os.makedirs(os.path.join(sdir, ".orig"), exist_ok=True)
    bpath = _backup_path(sdir, e["file"])
    if not os.path.isfile(bpath):  # keep the very first original for "Revert"
        shutil.copy2(src, bpath)
    _save_adjusted(out, text, src)
    _clear_thumbs(sdir, e["file"])
    e.update({"adjusted": True, "v": now})
    e.update(extra)
    return gid


def _do_adjust(s, gid, mode, params):
    sdir = os.path.realpath(st.session_dir(s))
    with st.LOCK:
        data = st.load_registry(s)
        e = data["entries"].get(gid)
        if not e:
            return 404, {"error": "unknown image"}
        src = _inside(sdir, e.get("file", ""))
        if not src or not os.path.isfile(src):
            return 404, {"error": "image file is missing"}
        with Image.open(src) as im:
            im.load()
            text = dict(getattr(im, "text", None) or {})
            out = color.adjust(im, params)
        result = _commit_image(data, sdir, e, gid, src, out, text, mode, "color", {"color_params": params})
        st.save_registry(s, data)
    return 200, {"ok": True, "id": result, "mode": mode}


@routes.post("/gen_archive/adjust")
async def api_adjust(request):
    body = await request.json()
    s = st.safe_name(body.get("session"))
    gid = str(body.get("id") or "")
    mode = "copy" if body.get("mode") == "copy" else "overwrite"
    params = color.clean_params(body.get("params"))
    if color.is_neutral(params):
        return web.json_response({"error": "nothing to apply"}, status=400)
    try:
        loop = asyncio.get_running_loop()
        status, payload = await loop.run_in_executor(None, _do_adjust, s, gid, mode, params)
    except Exception as e:
        return web.json_response({"error": f"{type(e).__name__}: {e} (is the file open in another program?)"}, status=500)
    return web.json_response(payload, status=status)


def _do_revert(s, gid):
    sdir = os.path.realpath(st.session_dir(s))
    with st.LOCK:
        data = st.load_registry(s)
        e = data["entries"].get(gid)
        if not e:
            return 404, {"error": "unknown image"}
        src = _inside(sdir, e.get("file", ""))
        bpath = _backup_path(sdir, e.get("file", ""))
        if not src or not os.path.isfile(bpath):
            return 404, {"error": "no backup of the original file"}
        tmp = os.path.join(os.path.dirname(src), ".tmp_" + os.path.basename(src))
        shutil.copy2(bpath, tmp)
        os.replace(tmp, src)
        try:
            os.remove(bpath)
        except OSError:
            pass
        _clear_thumbs(sdir, e["file"])
        e.pop("adjusted", None)
        e.pop("color_params", None)
        e["v"] = int(time.time() * 1000)
        st.save_registry(s, data)
    return 200, {"ok": True, "id": gid}


@routes.post("/gen_archive/revert")
async def api_revert(request):
    body = await request.json()
    s = st.safe_name(body.get("session"))
    try:
        loop = asyncio.get_running_loop()
        status, payload = await loop.run_in_executor(None, _do_revert, s, str(body.get("id") or ""))
    except Exception as e:
        return web.json_response({"error": f"{type(e).__name__}: {e}"}, status=500)
    return web.json_response(payload, status=status)


def _do_retouch(s, gid, mode, png_bytes):
    """Store an image composed in the browser (reference details painted back in)."""
    sdir = os.path.realpath(st.session_dir(s))
    with st.LOCK:
        data = st.load_registry(s)
        e = data["entries"].get(gid)
        if not e:
            return 404, {"error": "unknown image"}
        src = _inside(sdir, e.get("file", ""))
        if not src or not os.path.isfile(src):
            return 404, {"error": "image file is missing"}
        with Image.open(src) as im:
            im.load()
            text = dict(getattr(im, "text", None) or {})
            size = im.size
        with Image.open(io.BytesIO(png_bytes)) as up:
            up.load()
            out = up.convert("RGB")
        if out.size != size:
            out = out.resize(size, _RESAMPLE)
        result = _commit_image(data, sdir, e, gid, src, out, text, mode, "fix", {})
        st.save_registry(s, data)
    return 200, {"ok": True, "id": result, "mode": mode}


@routes.post("/gen_archive/retouch")
async def api_retouch(request):
    q = request.query
    s = st.safe_name(q.get("session"))
    gid = str(q.get("id") or "")
    mode = "copy" if q.get("mode") == "copy" else "overwrite"
    body = await request.read()
    if not body:
        return web.json_response({"error": "no image data"}, status=400)
    try:
        loop = asyncio.get_running_loop()
        status, payload = await loop.run_in_executor(None, _do_retouch, s, gid, mode, body)
    except Exception as e:
        return web.json_response({"error": f"{type(e).__name__}: {e} (is the file open in another program?)"}, status=500)
    return web.json_response(payload, status=status)


def _do_adjust_masked(s, gid, mode, params, mask_bytes):
    """Colour-correct only where the brush mask is painted (a half-transparent mask = half the effect)."""
    sdir = os.path.realpath(st.session_dir(s))
    with st.LOCK:
        data = st.load_registry(s)
        e = data["entries"].get(gid)
        if not e:
            return 404, {"error": "unknown image"}
        src = _inside(sdir, e.get("file", ""))
        if not src or not os.path.isfile(src):
            return 404, {"error": "image file is missing"}
        with Image.open(src) as im:
            im.load()
            text = dict(getattr(im, "text", None) or {})
            base = im.convert("RGB")
        with Image.open(io.BytesIO(mask_bytes)) as m:
            m.load()
            mask = m.getchannel("A") if m.mode in ("RGBA", "LA") else m.convert("L")
        if mask.size != base.size:  # the brush works at <= 3072px: scale the soft mask up smoothly
            mask = mask.resize(base.size, getattr(getattr(Image, "Resampling", Image), "BILINEAR"))
        out = Image.composite(color.adjust(base, params).convert("RGB"), base, mask)
        result = _commit_image(data, sdir, e, gid, src, out, text, mode, "color",
                               {"color_params": params, "color_masked": True})
        st.save_registry(s, data)
    return 200, {"ok": True, "id": result, "mode": mode}


@routes.post("/gen_archive/adjust_masked")
async def api_adjust_masked(request):
    q = request.query
    s = st.safe_name(q.get("session"))
    gid = str(q.get("id") or "")
    mode = "copy" if q.get("mode") == "copy" else "overwrite"
    try:
        params = color.clean_params(json.loads(q.get("params") or "{}"))
    except ValueError:
        return web.json_response({"error": "bad params"}, status=400)
    if color.is_neutral(params):
        return web.json_response({"error": "nothing to apply"}, status=400)
    body = await request.read()
    if not body:
        return web.json_response({"error": "no mask data"}, status=400)
    try:
        loop = asyncio.get_running_loop()
        status, payload = await loop.run_in_executor(None, _do_adjust_masked, s, gid, mode, params, body)
    except Exception as e:
        return web.json_response({"error": f"{type(e).__name__}: {e} (is the file open in another program?)"}, status=500)
    return web.json_response(payload, status=status)


def _do_adjust_many(s, ids, mode, params):
    """Apply the same adjustment to many images. The registry lock is taken per image,
    so a running generation (Generation Archive node) is never blocked for long."""
    done, failed = [], []
    for gid in sorted(set(ids), key=st.sort_key):
        try:
            status, payload = _do_adjust(s, gid, mode, params)
        except Exception as e:
            failed.append({"id": gid, "error": f"{type(e).__name__}: {e}"})
            continue
        if status == 200:
            done.append(payload["id"])
        else:
            failed.append({"id": gid, "error": payload.get("error", "failed")})
    return {"ok": True, "done": len(done), "ids": done, "failed": failed}


@routes.post("/gen_archive/adjust_batch")
async def api_adjust_batch(request):
    body = await request.json()
    s = st.safe_name(body.get("session"))
    ids = [i for i in (body.get("ids") or []) if isinstance(i, str)]
    mode = "copy" if body.get("mode") == "copy" else "overwrite"
    params = color.clean_params(body.get("params"))
    if color.is_neutral(params):
        return web.json_response({"error": "nothing to apply"}, status=400)
    loop = asyncio.get_running_loop()
    payload = await loop.run_in_executor(None, _do_adjust_many, s, ids, mode, params)
    return web.json_response(payload)


# ───────────────────── presets (global, shared by all sessions) ─────────────────────

def _presets_path():
    return os.path.join(st.archive_root(), "presets.json")


def _load_presets():
    try:
        with open(_presets_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("presets"), dict):
            return {str(k): color.clean_params(v) for k, v in data["presets"].items()}
    except (OSError, ValueError):
        pass
    return {}


def _save_presets(presets):
    os.makedirs(st.archive_root(), exist_ok=True)
    p = _presets_path()
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"presets": presets}, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)


@routes.get("/gen_archive/presets")
async def api_presets_get(request):
    with st.LOCK:
        return web.json_response({"presets": _load_presets()})


@routes.post("/gen_archive/presets")
async def api_presets_post(request):
    body = await request.json()
    action = body.get("action")
    name = str(body.get("name") or "").strip()[:60]
    with st.LOCK:
        presets = _load_presets()
        if action == "save":
            params = color.clean_params(body.get("params"))
            if not name:
                return web.json_response({"error": "empty preset name"}, status=400)
            if color.is_neutral(params):
                return web.json_response({"error": "all sliders are neutral - nothing to save"}, status=400)
            presets[name] = params
        elif action == "delete":
            presets.pop(name, None)
        else:
            return web.json_response({"error": "unknown action"}, status=400)
        _save_presets(presets)
    return web.json_response({"ok": True, "presets": presets})


def _open_path(path):
    if sys.platform.startswith("win"):
        os.startfile(path)  # noqa
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


@routes.post("/gen_archive/open_folder")
async def api_open_folder(request):
    body = await request.json()
    s = st.safe_name(body.get("session"))
    sdir = os.path.realpath(st.session_dir(s, create=True))
    sub = str(body.get("sub") or "")
    path = os.path.realpath(os.path.join(sdir, sub))
    if path != sdir and not path.startswith(sdir + os.sep):
        return web.json_response({"error": "forbidden"}, status=403)
    if not os.path.isdir(path):
        path = sdir
    try:
        _open_path(path)
    except Exception as e:
        return web.json_response({"error": str(e), "path": path}, status=500)
    return web.json_response({"ok": True, "path": path})
