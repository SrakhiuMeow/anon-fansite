# 项目约定（千早爱音应援站）

## 版本管理

- **本项目使用 Git 管理，之后的所有改动都要提交到 Git。** 每完成一处改动，就 `git add -A` 并写一条中文提交信息。
- 远端仓库是 `origin` → `git@github.com:SrakhiuMeow/anon-fansite.git`（私有）。提交后要 `git push`，让本地和远端保持一致；推送走 SSH，不需要额外配置代理。
- **`data/` 目录不入库**（已在 `.gitignore` 中排除）。里面是通过 Bestdori 抓取的原始 JSON 与清洗后的中间数据，体积大、可重新生成：

  > 规则必须写成根目录锚定的 `/data/`。写成 `data/` 会匹配任意层级的 data 目录，把 `assets/data/anon-cards.js` 一起排除；Vercel 的 Git 部署也会参考 `.gitignore`，那样线上卡面图鉴会直接 404。

  ```bash
  python3 scripts/fetch_bestdori.py     # 抓取素材（需要联网）
  python3 scripts/build_site_data.py    # 重新生成 assets/data/anon-cards.js
  ```

- 生成物 `assets/data/anon-cards.js` 是要入库的，这样没有 `data/` 也能正常打开站点。
- 提交信息写清楚「改了什么、为什么」，例如：`补上 ★5 卡面筛选与灯箱特训切换`。
- 不要提交临时文件、截图产物与本地服务日志。

## 目录职责

| 目录 | 用途 | 是否入库 |
| --- | --- | --- |
| `index.html`、`assets/` | 站点本体（页面、样式、脚本、图片、生成的数据文件） | 是 |
| `scripts/` | 抓取与生成脚本 | 是 |
| `data/` | Bestdori 原始数据与中间产物 | 否 |
| `README.md` | 规划文档与使用说明 | 是 |

## 素材版权

卡面与立绘版权归 BanG Dream! Project / Bushiroad 所有，仅作个人学习与自用演示。
公开上线前需替换为自制素材，并保留页面上的来源声明。
