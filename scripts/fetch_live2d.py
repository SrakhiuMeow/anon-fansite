#!/usr/bin/env python3
"""
从 Bestdori 下载「千早爱音」的全部 Live2D 模型，并转换成网页可用的 Cubism 2.1 结构。

    python3 scripts/fetch_live2d.py           # 增量下载
    python3 scripts/fetch_live2d.py --force   # 全部重下

服装清单来自两处：
    /api/characters/37.json                 季节服装（私服、制服）
    /api/explorer/jp/assets/_info.json      资源索引里所有 037_ 开头的 Live2D 包（卡面服装）
    /api/costumes/all.5.json                包名对应的卡面名、服装 ID 与实装日期

Bestdori 上的 Live2D 是游戏拆包资源：每个服装一套，含
    buildData.asset   资源清单（JSON，记录模型/物理/贴图/动作/表情的文件名）
    *.moc             模型本体（Cubism 2.1）
    *.physics.json    物理演算
    texture_*.png     贴图
    *.mtn.bytes       动作（去掉 .bytes 即为标准 .mtn）
    *.exp.json        表情

多个包共用 037_general 里的通用动作与第一张贴图，脚本会按 buildData 的 bundleName
从对应目录取文件；没有 buildData 的包（如只放动作的 037_general）会记为跳过。

脚本会按 buildData 把这些文件抓齐，并生成标准 Cubism 2 的 model.json，
让 pixi-live2d-display 能直接加载。

产物：
    assets/live2d/<服装>/            模型文件（model.json / moc / 贴图 / 动作 / 表情）
    assets/data/anon-live2d.js       站点读取的清单（window.ANON_LIVE2D）
    data/bestdori/raw/character_37.json   角色接口原始数据留档

模型版权归 BanG Dream! Project / Bushiroad 所有，仅供个人学习与自用演示。
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "bestdori" / "raw"
L2D_DIR = ROOT / "assets" / "live2d"
DATA_OUT = ROOT / "assets" / "data" / "anon-live2d.js"

CHARACTER_ID = 37
CHARACTER_PREFIX = f"{CHARACTER_ID:03d}_"
API = "https://bestdori.com/api"
ASSET = "https://bestdori.com/assets/{server}/{bundle}_rip/{name}"
EXPLORER_INFO = "https://bestdori.com/api/explorer/{server}/assets/_info.json"
COSTUME_INDEX = f"{API}/costumes/all.5.json"
INDEX_CACHE = RAW_DIR / "asset_index_jp.json"
COSTUME_CACHE = RAW_DIR / "costumes_all_5.json"
SERVERS = ("jp", "cn")
SLEEP = 0.1

CARD_COSTUME_PREFIX = "卡面服装 · "

COSTUME_LABEL = {
    "CASUAL_SPRING": "私服（春）",
    "CASUAL_SUMMER": "私服（夏）",
    "CASUAL_AUTUMN": "私服（秋）",
    "CASUAL_WINTER": "私服（冬）",
    "UNIFORM_WINTER": "制服（冬）",
    "UNIFORM_SUMMER": "制服（夏）",
}

OPENER = urllib.request.build_opener()
OPENER.addheaders = [
    ("User-Agent", "Mozilla/5.0 (compatible; anon-fansite-demo/1.0)"),
    ("Referer", "https://bestdori.com/"),
]


def log(msg: str) -> None:
    print(msg, flush=True)


def fetch_bytes(url: str) -> bytes | None:
    """下载字节；Bestdori 用 HTML 错误页表示缺失文件，这里按内容类型过滤。"""
    try:
        with OPENER.open(url, timeout=45) as resp:
            ctype = resp.headers.get("Content-Type", "")
            data = resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        log(f"    ! {url} -> {exc}")
        return None
    if "text/html" in ctype:
        return None
    return data


def fetch_asset(bundle: str, name: str) -> bytes | None:
    for server in SERVERS:
        data = fetch_bytes(ASSET.format(server=server, bundle=bundle, name=name))
        time.sleep(SLEEP)
        if data:
            return data
    return None


def fetch_json(url: str) -> dict:
    with OPENER.open(url, timeout=45) as resp:
        return json.load(resp)


def cached_json(url: str, cache: Path, force: bool) -> dict:
    """接口结果留档到 data/ 下，便于离线重跑与核对当天看到的清单。"""
    if cache.exists() and not force:
        return json.loads(cache.read_text(encoding="utf-8"))
    data = fetch_json(url)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def save(data: bytes, dest: Path, force: bool) -> bool:
    if dest.exists() and not force:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return True


def season_costumes(char: dict) -> list[dict]:
    """角色接口里的季节服装（私服 / 制服）。"""
    seen: dict[str, dict] = {}
    for payload in (char.get("seasonCostumeListMap") or {}).get("entries", {}).values():
        for item in payload.get("entries", []):
            name = item.get("live2dAssetBundleName")
            if not name or name in seen:
                continue
            seen[name] = {
                "bundle": name,
                "label": COSTUME_LABEL.get(
                    item.get("seasonCostumeType") or "", item.get("seasonCostumeType") or name
                ),
                "costumeType": item.get("costumeType"),
                "kind": "season",
            }
    return list(seen.values())


def discovered_bundles(force: bool) -> list[str]:
    """资源索引里所有该角色的 Live2D 包（含卡面服装）。"""
    index = cached_json(EXPLORER_INFO.format(server="jp"), INDEX_CACHE, force)
    names = index.get("live2d", {}).get("chara", {})
    return sorted(name for name in names if name.startswith(CHARACTER_PREFIX))


def card_costume_index(force: bool) -> dict[str, dict]:
    """服装接口：包名 -> 卡面名（中文优先）、服装 ID 与日服实装日期。"""
    raw = cached_json(COSTUME_INDEX, COSTUME_CACHE, force)
    items: dict[str, dict] = {}
    for key, value in raw.items():
        if not isinstance(value, dict) or value.get("characterId") != CHARACTER_ID:
            continue
        bundle = value.get("assetBundleName")
        if not bundle:
            continue
        names = value.get("description") or []
        title = (names[3] if len(names) > 3 and names[3] else (names[0] if names else "")) or ""
        published = [int(stamp) for stamp in (value.get("publishedAt") or []) if stamp and stamp != "0"]
        items[bundle] = {
            "costumeId": int(key),
            "cardTitle": title,
            "cardTitleJp": names[0] if names else "",
            "appliedAt": time.strftime("%Y-%m-%d", time.gmtime(min(published) / 1000)) if published else "",
        }
    return items


def costume_entries(char: dict, force: bool) -> list[dict]:
    """季节服装 + 资源索引里发现的卡面服装，季节款在前、卡面款按服装编号排序。"""
    entries = season_costumes(char)
    seen = {item["bundle"] for item in entries}
    cards = card_costume_index(force)
    for bundle in discovered_bundles(force):
        if bundle in seen:
            continue
        seen.add(bundle)
        meta = cards.get(bundle) or {}
        title = meta.get("cardTitle") or ""
        entries.append({
            "bundle": bundle,
            "label": f"{CARD_COSTUME_PREFIX}{title}" if title else bundle,
            "cardTitle": title,
            "costumeId": meta.get("costumeId"),
            "appliedAt": meta.get("appliedAt") or "",
            "kind": "card",
        })
    entries.sort(key=lambda item: (0 if item.get("kind") == "season" else 1, item.get("costumeId") or 10 ** 6))
    return entries


def build_costume(costume: dict, force: bool) -> dict | None:
    bundle = costume["bundle"]
    folder = L2D_DIR / bundle
    log(f"  · {bundle}（{costume['label']}）")

    build_path = folder / "buildData.asset"
    if build_path.exists() and not force:
        build = json.loads(build_path.read_text(encoding="utf-8"))["Base"]
    else:
        raw = fetch_asset(f"live2d/chara/{bundle}", "buildData.asset")
        if not raw:
            log("    ! 取不到 buildData.asset，跳过")
            return None
        build = json.loads(raw)["Base"]
        save(raw, build_path, True)

    manifest: dict = {
        "bundle": bundle,
        "label": costume["label"],
        "kind": costume.get("kind", "card"),
        "cardTitle": costume.get("cardTitle", ""),
        "costumeId": costume.get("costumeId"),
        "appliedAt": costume.get("appliedAt", ""),
        "motions": [],
        "expressions": [],
    }

    # 1) 模型本体（fileName 形如 anon_casual-2023.moc.bytes，去掉末尾 6 个字符）
    model_ref = build.get("model") or {}
    model_name = (model_ref.get("fileName") or "")[:-6]
    if model_name:
        data = fetch_asset(model_ref.get("bundleName", bundle), model_name)
        if not data:
            log("    ! 取不到模型本体，跳过")
            return None
        save(data, folder / model_name, force)
        manifest["model"] = model_name
        log(f"    模型 {model_name} ({len(data) / 1024:.0f}KB)")

    # 2) 物理
    physics_ref = build.get("physics") or {}
    physics_name = physics_ref.get("fileName")
    if physics_name:
        data = fetch_asset(physics_ref.get("bundleName", bundle), physics_name)
        if data:
            save(data, folder / physics_name, force)
            manifest["physics"] = physics_name

    # 3) 贴图
    textures = []
    for tex in build.get("textures") or []:
        name = tex.get("fileName")
        if not name:
            continue
        if not name.lower().endswith(".png"):
            name += ".png"
        data = fetch_asset(tex.get("bundleName", bundle), name)
        if data:
            save(data, folder / name, force)
            textures.append(name)
    manifest["textures"] = textures
    log(f"    贴图 {len(textures)} 张")

    # 4) 动作（.mtn.bytes -> .mtn）
    motions = []
    for motion in build.get("motions") or []:
        file_name = motion.get("fileName") or ""
        if not file_name.endswith((".mtn.bytes", ".mtn")):
            continue
        name = file_name[:-6] if file_name.endswith(".bytes") else file_name
        data = fetch_asset(motion.get("bundleName", bundle), name)
        if not data:
            continue
        save(data, folder / "motions" / Path(name).name, force)
        motions.append(Path(name).name)
    manifest["motions"] = motions
    log(f"    动作 {len(motions)} 个")

    # 5) 表情
    expressions = []
    for exp in build.get("expressions") or []:
        name = exp.get("fileName")
        if not name:
            continue
        data = fetch_asset(exp.get("bundleName", bundle), name)
        if not data:
            continue
        save(data, folder / "expressions" / Path(name).name, force)
        expressions.append({"name": Path(name).name[: -len(".exp.json")], "file": f"expressions/{Path(name).name}"})
    manifest["expressions"] = expressions
    log(f"    表情 {len(expressions)} 个")

    # 6) 生成标准 Cubism 2 model.json
    model_json = {
        "version": "1.0.0",
        "model": manifest.get("model", ""),
        "textures": manifest["textures"],
        "physics": manifest.get("physics", ""),
        # Cubism 2 会自动随机播放 idle 组；这里只放待机，情绪动作单独按索引调用。
        "motions": {
            "idle": [{"file": "motions/idle01.mtn", "fade_in": 500, "fade_out": 500}]
            if "idle01.mtn" in motions else [],
            "reaction": [{"file": f"motions/{m}", "fade_in": 500, "fade_out": 500} for m in motions],
        },
        "expressions": manifest["expressions"],
    }
    model_json = {k: v for k, v in model_json.items() if v not in ("", None)}
    (folder / "model.json").write_text(
        json.dumps(model_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    manifest["modelJson"] = f"assets/live2d/{bundle}/model.json"
    (folder / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    log("== Bestdori Live2D 抓取 · 千早爱音 ==")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cache = RAW_DIR / f"character_{CHARACTER_ID}.json"
    if cache.exists() and not args.force:
        char = json.loads(cache.read_text(encoding="utf-8"))
    else:
        char = fetch_json(f"{API}/characters/{CHARACTER_ID}.json")
        cache.write_text(json.dumps(char, ensure_ascii=False, indent=2), encoding="utf-8")

    costumes = costume_entries(char, args.force)
    log(f"发现 {len(costumes)} 套 Live2D 服装（季节服装 + 资源索引里的卡面服装）")

    manifests = []
    skipped = []
    for costume in costumes:
        got = build_costume(costume, args.force)
        if got:
            manifests.append(got)
        else:
            skipped.append(costume["bundle"])

    if not manifests:
        log("没有成功下载任何模型。")
        return 1

    # 保留另一个抓取脚本导入的 Our Notes 模型，重抓 Bestdori 不应删掉可选服装。
    other_costumes = []
    bdon_catalog = None
    previous_default = None
    if DATA_OUT.exists():
        previous_text = DATA_OUT.read_text(encoding="utf-8")
        try:
            previous = json.loads(previous_text[previous_text.index("{"):previous_text.rindex("}") + 1])
            other_costumes = [c for c in previous.get("costumes", []) if c.get("id", "").startswith("bdon_")]
            bdon_catalog = previous.get("bdonCatalog")
            previous_default = previous.get("defaultCostume")
        except (ValueError, json.JSONDecodeError):
            raise RuntimeError("现有 Live2D 清单无效；停止生成，避免覆盖其他来源模型")

    # 默认服装优先沿用上次的选择；模型被上游移除时才退回第一套。
    default_costume = next(
        (item["bundle"] for item in manifests if item["bundle"] == previous_default),
        manifests[0]["bundle"],
    )

    DATA_OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "https://bestdori.com",
        "sources": ["https://bestdori.com"] + (["https://bdon.moe"] if other_costumes else []),
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "characterId": CHARACTER_ID,
        "defaultCostume": default_costume,
        "costumes": [
            {
                "id": m["bundle"],
                "label": m["label"],
                "modelJson": m["modelJson"],
                "source": "https://bestdori.com",
                "kind": m.get("kind"),
                **({"cardTitle": m["cardTitle"]} if m.get("cardTitle") else {}),
                **({"costumeId": m["costumeId"]} if m.get("costumeId") else {}),
                **({"appliedAt": m["appliedAt"]} if m.get("appliedAt") else {}),
                "motionCount": len(m["motions"]),
                "expressionCount": len(m["expressions"]),
                "motions": m["motions"],
                "expressions": [e["name"] for e in m["expressions"]],
            }
            for m in manifests
        ] + other_costumes,
        "bestdoriCatalog": {
            "checkedAt": time.strftime("%Y-%m-%d"),
            "bundles": [item["bundle"] for item in costumes],
            "skipped": skipped,
        },
    }
    if bdon_catalog is not None:
        payload["bdonCatalog"] = bdon_catalog
    DATA_OUT.write_text(
        "/* 由 scripts/fetch_live2d.py 与 scripts/fetch_bdon_live2d.cjs 生成。来源：Bestdori / bdon.moe */\n"
        "window.ANON_LIVE2D = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )

    log("")
    log(f"完成：{len(manifests)} 套 Live2D -> {L2D_DIR.relative_to(ROOT)}")
    log(f"清单：{DATA_OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
