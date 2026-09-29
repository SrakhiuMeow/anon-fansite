#!/usr/bin/env python3
"""
把 Bestdori 抓取结果转换成站点直接可用的数据文件。

    python3 scripts/build_site_data.py

输入: data/bestdori/anon-chihaya.json
输出: assets/data/anon-cards.js   （window.ANON_DATA = {...}）

用 JS 数据文件而不是 fetch(JSON)，是为了让页面用 file:// 直接双击打开也能正常工作。
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "bestdori" / "anon-chihaya.json"
OUT = ROOT / "assets" / "data" / "anon-cards.js"

HERO_CARD = "res037002"          # 首屏展示用的卡面
HERO_STANDING = "res037002"      # 首屏透明底立绘
FEATURED = [                      # 首屏下方「精选」顺序
    "res037003",
    "res037012",
    "res037007",
    "res037008",
    "res037015",
    "res037004",
]

TYPE_CN = {
    "limited": "限定",
    "permanent": "常驻",
    "initial": "初始",
    "event": "活动",
}


def pick_variant(images: dict) -> str | None:
    """优先展示「特训后」卡面。"""
    if "after_training" in images:
        return "after_training"
    if "normal" in images:
        return "normal"
    return None


def main() -> int:
    payload = json.loads(SRC.read_text(encoding="utf-8"))

    cards = []
    for card in payload["cards"]:
        images = card.get("images") or {}
        default = pick_variant(images)
        if not default:
            continue

        variants = {}
        for key, img in images.items():
            variants[key] = {
                "file": img["file"],
                "thumb": img.get("thumb") or img["file"],
                "width": img.get("width"),
                "height": img.get("height"),
            }

        cards.append(
            {
                "res": card["resourceSetName"],
                "rarity": card.get("rarity"),
                "attribute": card.get("attribute"),
                "attributeCn": card.get("attributeCn"),
                "attributeColor": card.get("attributeColor"),
                "nameJa": (card.get("prefix") or {}).get("ja"),
                "nameCn": (card.get("prefix") or {}).get("zh_cn"),
                "nameEn": (card.get("prefix") or {}).get("en"),
                "date": card.get("releasedAt"),
                "type": card.get("type"),
                "typeCn": TYPE_CN.get(card.get("type"), card.get("type")),
                "standing": card.get("standing"),
                "default": default,
                "variants": variants,
            }
        )

    by_res = {c["res"]: c for c in cards}
    hero = by_res.get(HERO_CARD) or cards[0]
    featured = [by_res[r] for r in FEATURED if r in by_res]

    data = {
        "source": payload.get("source"),
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "character": payload["character"],
        "cardCount": len(cards),
        "rarityBreakdown": {
            str(r): sum(1 for c in cards if c["rarity"] == r) for r in (5, 4, 3, 2, 1)
        },
        "hero": {
            "res": hero["res"],
            "file": hero["variants"][hero["default"]]["file"],
            "caption": hero["nameCn"],
            "standing": (by_res.get(HERO_STANDING) or hero).get("standing"),
        },
        "featured": [c["res"] for c in featured],
        "cards": cards,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "/* 由 scripts/build_site_data.py 生成，请勿手改。数据来源：Bestdori */\n"
        "window.ANON_DATA = "
        + json.dumps(data, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )

    print(f"卡片 {len(cards)} 张 -> {OUT.relative_to(ROOT)}")
    print("稀有度分布:", data["rarityBreakdown"])
    print("首屏卡面:", hero["res"], hero["nameCn"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
