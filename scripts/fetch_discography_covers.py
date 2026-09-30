#!/usr/bin/env python3
"""
从 BanG Dream! 官方网站抓取 MyGO!!!!! 单曲与专辑的官方封面。

用法:
    python3 scripts/fetch_discography_covers.py            # 增量下载（已存在的文件会跳过）
    python3 scripts/fetch_discography_covers.py --force    # 重新下载全部
    python3 scripts/fetch_discography_covers.py --offline  # 只用本地缓存重新生成尺寸版本

产物:
    data/discography/raw/          官方页面 JSON 快照（留档用，不入库）
    assets/img/music/              网页用封面（640px 宽 JPEG）
    assets/img/music/thumbs/       列表用缩略图（320px 宽 WebP）

封面从「ディスコグラフィ一覧」列表页的缩略图读取，来源页面记录在
data/discography/raw/ 与 docs/SOURCES.md。图片版权归 BanG Dream! Project /
Bushiroad 所有，仅用于非商业应援展示；公开传播前请确认授权范围。
"""

from __future__ import annotations

import argparse
import io
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "discography" / "raw"
FULL_DIR = ROOT / "assets" / "img" / "music"
THUMB_DIR = FULL_DIR / "thumbs"

LIST_URL = "https://bang-dream.com/discographies/page/{page}/?artist=mygo"
LIST_PAGES = (1, 2, 3)
SITE = "https://bang-dream.com"

# 站内 key → 官方 discography 编号与名称
RELEASES = {
    "01-single-mayoiuta": ("3107", "迷星叫"),
    "02-single-otoichie": ("3234", "音一会"),
    "03-single-hitoshi": ("3368", "壱雫空"),
    "04-single-sasurai": ("3575", "砂寸奏／回層浮"),
    "05-single-panorama": ("3735", "端程山"),
    "06-single-ichijitsu": ("3908", "聿日箋秋"),
    "07-single-ourai": ("4092", "往欄印"),
    "08-single-silent": ("4132", "静降想"),
    "09-single-sepia": ("4236", "世点彩"),
    "10-album-meisekiha": ("3457", "迷跡波"),
    "11-album-michinoku": ("3846", "跡暖空"),
    "12-album-chiheisen": ("4165", "致並跡"),
}

FULL_WIDTH = 640
THUMB_WIDTH = 320

OPENER = urllib.request.build_opener()
OPENER.addheaders = [
    ("User-Agent", "Mozilla/5.0 (compatible; anon-fansite-demo/1.0)"),
    ("Accept-Language", "ja,en;q=0.8"),
]


def log(message: str) -> None:
    print(message, flush=True)


def fetch(url: str) -> bytes:
    with OPENER.open(url, timeout=60) as response:
        return response.read()


def collect_covers(force: bool) -> dict[str, dict[str, str]]:
    """读取官方列表页，得到每个发行编号的封面图地址。"""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    covers: dict[str, dict[str, str]] = {}
    for page in LIST_PAGES:
        cache = RAW_DIR / f"discographies-page-{page}.html"
        if force or not cache.exists():
            log(f"下载列表页 {LIST_URL.format(page=page)}")
            cache.write_bytes(fetch(LIST_URL.format(page=page)))
        html = cache.read_text(encoding="utf-8", errors="ignore")
        for match in re.finditer(r"<article class=\"p-discography-list__item\">.*?</article>", html, re.S):
            block = match.group(0)
            href = re.search(r'href="https://bang-dream\.com/discographies/(\d+)/"', block)
            image = re.search(r'<img src="([^"]+)"', block)
            title = re.search(r'class="p-discography-list__item-title">(.*?)</div>', block, re.S)
            if not (href and image):
                continue
            covers[href.group(1)] = {
                "image": image.group(1),
                "label": re.sub(r"<[^>]+>", "", title.group(1)).strip() if title else "",
                "page": SITE + f"/discographies/{href.group(1)}/",
            }
    return covers


def write_images(key: str, raw: bytes, force: bool) -> None:
    try:
        from PIL import Image  # 仅在生成缩略图时需要
    except ImportError:  # pragma: no cover - 依赖提示
        raise SystemExit("需要 Pillow 才能生成封面：python3 -m pip install Pillow")

    FULL_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    full_path = FULL_DIR / f"{key}.jpg"
    thumb_path = THUMB_DIR / f"{key}.webp"
    cache_path = RAW_DIR / f"cover-{key}.jpg"
    if force or not cache_path.exists():
        cache_path.write_bytes(raw)

    image = Image.open(io.BytesIO(cache_path.read_bytes())).convert("RGB")
    if force or not full_path.exists():
        full = image if image.width <= FULL_WIDTH else image.resize(
            (FULL_WIDTH, round(image.height * FULL_WIDTH / image.width)), Image.LANCZOS
        )
        full.save(full_path, "JPEG", quality=84, optimize=True, progressive=True)
    if force or not thumb_path.exists():
        thumb = image if image.width <= THUMB_WIDTH else image.resize(
            (THUMB_WIDTH, round(image.height * THUMB_WIDTH / image.width)), Image.LANCZOS
        )
        thumb.save(thumb_path, "WEBP", quality=80, method=6)
    log(f"  {key}: {full_path.relative_to(ROOT)} {full_path.stat().st_size // 1024} KiB · "
        f"{thumb_path.relative_to(ROOT)} {thumb_path.stat().st_size // 1024} KiB")


def main() -> None:
    parser = argparse.ArgumentParser(description="抓取 MyGO!!!!! 官方封面")
    parser.add_argument("--force", action="store_true", help="忽略已有文件并重新下载")
    parser.add_argument("--offline", action="store_true", help="只用 data/discography/raw 缓存")
    args = parser.parse_args()

    covers = collect_covers(args.force)
    manifest = []
    for key, (release_id, title) in RELEASES.items():
        info = covers.get(release_id)
        if not info:
            raise SystemExit(f"列表页里没有找到 {title}（编号 {release_id}）")
        cache_path = RAW_DIR / f"cover-{key}.jpg"
        if args.offline:
            if not cache_path.exists():
                raise SystemExit(f"--offline 需要本地缓存：{cache_path.relative_to(ROOT)}")
            raw = cache_path.read_bytes()
        else:
            log(f"下载封面 {title}：{info['image']}")
            raw = fetch(info["image"])
        write_images(key, raw, args.force)
        manifest.append({
            "key": key,
            "title": title,
            "releaseId": release_id,
            "page": info["page"],
            "image": info["image"],
            "label": info["label"],
        })

    (RAW_DIR / "covers.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    log(f"完成，共 {len(manifest)} 张封面；来源清单见 data/discography/raw/covers.json")


if __name__ == "__main__":
    main()
