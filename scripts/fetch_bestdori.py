#!/usr/bin/env python3
"""
从 Bestdori 下载「千早爱音」(角色ID 37) 的资料与图片素材。

用法:
    python3 scripts/fetch_bestdori.py            # 增量下载（已存在的文件会跳过）
    python3 scripts/fetch_bestdori.py --force    # 重新下载全部

产物:
    data/bestdori/raw/          Bestdori API 原始 JSON（留档用）
    data/bestdori/anon-chihaya.json   清洗后的角色 + 卡片数据（站点直接读取）
    assets/img/cards/           卡面原图（特训前 / 特训后）
    assets/img/cards/thumbs/    网页用缩略图（webp）
    assets/img/standing/        透明底全身立绘（trim 素材）

素材版权归 BanG Dream! Project / Bushiroad 所有，Bestdori 仅为资料整理站点。
请仅用于个人学习与自用，公开传播前请确认授权范围。
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "bestdori" / "raw"
DATA_OUT = ROOT / "data" / "bestdori" / "anon-chihaya.json"
CARD_DIR = ROOT / "assets" / "img" / "cards"
THUMB_DIR = CARD_DIR / "thumbs"
STANDING_DIR = ROOT / "assets" / "img" / "standing"

API = "https://bestdori.com/api"
ASSET = "https://bestdori.com/assets/{server}/characters/resourceset/{res}_rip/{name}.png"
# 部分联动卡（如 bilibili 合作卡）只存在于特定服务器目录
ASSET_SERVERS = ("jp", "cn")

CHARACTER_KEY = "愛音"
SLEEP = 0.15

ATTRIBUTE_CN = {
    "happy": ("快乐", "#ff9d5c"),
    "pure": ("纯粹", "#5fc98f"),
    "cool": ("酷", "#5b9dff"),
    "powerful": ("强力", "#ff6b6b"),
}

OPENER = urllib.request.build_opener()
OPENER.addheaders = [
    ("User-Agent", "Mozilla/5.0 (compatible; anon-fansite-demo/1.0)"),
    ("Referer", "https://bestdori.com/"),
]


def log(msg: str) -> None:
    print(msg, flush=True)


def fetch_bytes(url: str) -> bytes | None:
    """下载并返回字节；非图片（Bestdori 用 HTML 表示缺失）返回 None。"""
    try:
        with OPENER.open(url, timeout=45) as resp:
            ctype = resp.headers.get("Content-Type", "")
            data = resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        log(f"    ! {url.split('/')[-1]} -> {exc}")
        return None

    if "image" not in ctype:
        return None
    return data


def fetch_asset(res: str, name: str) -> bytes | None:
    """按 jp → cn 的顺序尝试各服务器目录。"""
    for server in ASSET_SERVERS:
        data = fetch_bytes(ASSET.format(server=server, res=res, name=name))
        time.sleep(SLEEP)
        if data:
            if server != "jp":
                log(f"    · {name} 命中 {server} 服目录")
            return data
    return None


def fetch_json(url: str) -> dict:
    with OPENER.open(url, timeout=45) as resp:
        return json.load(resp)


def ensure_raw(rel_name: str, url: str, force: bool) -> dict:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / rel_name
    if force or not path.exists():
        log(f"  下载原始数据 {rel_name}")
        payload = fetch_json(url)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return payload
    return json.loads(path.read_text(encoding="utf-8"))


def save_image(data: bytes, dest: Path, force: bool) -> bool:
    if dest.exists() and not force:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return True


def image_size(path: Path) -> tuple[int, int] | None:
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


def make_thumb(src: Path, dest: Path, width: int = 640, quality: int = 82) -> bool:
    """生成网页用缩略图（优先 webp，不支持则退回 jpg）。"""
    try:
        from PIL import Image
    except ImportError:
        return False

    try:
        with Image.open(src) as im:
            im = im.convert("RGBA")
            ratio = width / im.width
            im = im.resize((width, max(1, round(im.height * ratio))), Image.LANCZOS)
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                im.save(dest, "WEBP", quality=quality, method=5)
                return True
            except Exception:
                fallback = dest.with_suffix(".jpg")
                im.convert("RGB").save(fallback, "JPEG", quality=quality, optimize=True)
                return True
    except Exception as exc:  # 单个文件失败不影响整体
        log(f"    ! 缩略图失败 {src.name}: {exc}")
        return False


def to_date(ms: str | None) -> str | None:
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return None


def plausible(ms: str | None) -> bool:
    """过滤掉占位用的假日期（如 2100 年）。"""
    date = to_date(ms)
    if not date:
        return False
    year = int(date[:4])
    return 2021 <= year <= datetime.now(timezone.utc).year + 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="忽略本地缓存，重新下载")
    args = parser.parse_args()

    log("== Bestdori 素材抓取 · 千早爱音 ==")

    characters = ensure_raw("characters_all.json", f"{API}/characters/all.2.json", args.force)
    cards = ensure_raw("cards_all.json", f"{API}/cards/all.5.json", args.force)
    bands = ensure_raw("bands_all.json", f"{API}/bands/all.1.json", args.force)

    char_id = next(
        (cid for cid, v in characters.items() if CHARACTER_KEY in str(v.get("characterName", []))),
        None,
    )
    if char_id is None:
        log("找不到角色，终止。")
        return 1

    char = characters[char_id]
    band_id = str(char.get("bandId"))
    band = bands.get(band_id, {})
    band_name = (band.get("bandName") or ["?"])[0]
    log(f"角色 ID {char_id} · {char['characterName'][0]} · 乐队 {band_name} (id {band_id})")

    # 按 resourceSetName 去重，优先保留日期合理的记录
    by_res: dict[str, dict] = {}
    for card in cards.values():
        if str(card.get("characterId")) != str(char_id):
            continue
        res = card.get("resourceSetName")
        if not res:
            continue
        current = by_res.get(res)
        if current is None:
            by_res[res] = card
            continue
        cur_ok = plausible((current.get("releasedAt") or [None])[0])
        new_ok = plausible((card.get("releasedAt") or [None])[0])
        if new_ok and not cur_ok:
            by_res[res] = card
        elif new_ok == cur_ok and (card.get("prefix") or [None])[3]:
            by_res[res] = card

    log(f"去重后卡片数：{len(by_res)}")

    result_cards = []
    total_bytes = 0

    for res in sorted(by_res):
        card = by_res[res]
        log(f"  · {res}")
        entry = {
            "resourceSetName": res,
            "rarity": card.get("rarity"),
            "attribute": card.get("attribute"),
            "levelLimit": card.get("levelLimit"),
            "type": card.get("type"),
            "prefix": {
                "ja": (card.get("prefix") or [None])[0],
                "en": (card.get("prefix") or [None])[1],
                "zh_tw": (card.get("prefix") or [None])[2],
                "zh_cn": (card.get("prefix") or [None])[3],
            },
            "releasedAt": to_date((card.get("releasedAt") or [None])[0]),
            "images": {},
        }

        # 卡面：特训前 / 特训后
        for variant in ("after_training", "normal"):
            dest = CARD_DIR / f"{res}_{variant}.png"
            if dest.exists() and not args.force:
                size = dest.stat().st_size
            else:
                data = fetch_asset(res, f"card_{variant}")
                if not data:
                    continue
                save_image(data, dest, args.force)
                size = len(data)
                total_bytes += size
            dims = image_size(dest)
            web = f"assets/img/cards/{dest.name}"
            thumb_png = THUMB_DIR / f"{res}_{variant}.webp"
            make_thumb(dest, thumb_png)
            thumb = None
            if thumb_png.exists():
                thumb = f"assets/img/cards/thumbs/{thumb_png.name}"
            elif thumb_png.with_suffix(".jpg").exists():
                thumb = f"assets/img/cards/thumbs/{thumb_png.with_suffix('.jpg').name}"
            entry["images"][variant] = {
                "file": web,
                "thumb": thumb,
                "width": dims[0] if dims else None,
                "height": dims[1] if dims else None,
                "bytes": size,
            }

        # 全身立绘（透明底 trim 素材）：优先特训后
        for variant in ("after_training", "normal"):
            dest = STANDING_DIR / f"{res}.png"
            if dest.exists() and not args.force:
                pass
            else:
                data = fetch_asset(res, f"trim_{variant}")
                if not data:
                    continue
                save_image(data, dest, args.force)
                total_bytes += len(data)
            entry["standing"] = f"assets/img/standing/{dest.name}"
            break

        if not entry["images"]:
            log("    - 无可用卡面，跳过")
            continue

        attr = entry["attribute"]
        entry["attributeCn"] = ATTRIBUTE_CN.get(attr, (attr, None))[0]
        entry["attributeColor"] = ATTRIBUTE_CN.get(attr, (None, None))[1]
        result_cards.append(entry)

    # 排序：稀有度降序 → 日期新到旧
    result_cards.sort(key=lambda c: (-(c["rarity"] or 0), (c["releasedAt"] or "")), reverse=True)

    payload = {
        "source": "https://bestdori.com",
        "fetchedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "character": {
            "id": int(char_id),
            "name": {
                "ja": char["characterName"][0],
                "en": char["characterName"][1],
                "zh_tw": char["characterName"][2],
                "zh_cn": char["characterName"][3],
            },
            "firstName": (char.get("firstName") or [None])[0],
            "lastName": (char.get("lastName") or [None])[0],
            "colorCode": char.get("colorCode"),
            "bandId": int(band_id) if band_id else None,
            "bandName": band_name,
        },
        "cardCount": len(result_cards),
        "cards": result_cards,
    }

    DATA_OUT.parent.mkdir(parents=True, exist_ok=True)
    DATA_OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    log("")
    log(f"完成：{len(result_cards)} 张卡片")
    log(f"本次下载约 {total_bytes / 1024 / 1024:.1f} MB")
    log(f"数据文件：{DATA_OUT.relative_to(ROOT)}")
    log(f"卡面目录：{CARD_DIR.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
