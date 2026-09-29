# 千早爱音 应援站 · 规划与 Demo

一个为「千早爱音（ちはや あのん / Chihaya Anon）」制作的应援网站，角色资料、卡面与立绘素材取自 [Bestdori](https://bestdori.com)。

> Demo 入口：index.html（纯静态，无需安装依赖，双击即可打开）

---

## 1. 一句话定位

**「给一个想被所有人看见的女孩子，做一个也被所有人看见的网站。」**

不做百科式的资料堆砌，而是有观点、有情绪的角色应援站：资料可溯源、解读有立场、视觉有性格。

## 2. 目标与受众

| 项 | 说明 |
| --- | --- |
| 主要受众 | MyGO!!!!! / BanG Dream! 的粉丝；中文圈动画观众 |
| 次要受众 | 刚认识爱音、想快速了解她的人 |
| 核心目标 | 3 分钟内让人「记住爱音是谁、她为什么有意思」 |
| 成功信号 | 有人愿意转发性格解读、有人愿意在留言板写字、有人翻完 16 张卡面 |

## 3. 信息架构

| 栏目 | 内容 | 数据来源 |
| --- | --- | --- |
| Hero | 官方透明立绘 + 姓名 + 四个关键数字 | Bestdori 立绘 |
| 角色资料 Profile | 生日 / 身高 / 担当 / 成员色 / 学校 / 声优 / 所属 / 卡面数 | 官方角色页 + Bestdori |
| 官方介绍 About | 官网原文 + 中文翻译 + 解读 | 动画官网 |
| 性格关键词 Traits | 6 张卡：承认欲求、社交力、ミーハー、成绩、不服输、在意目光 | 官方设定 + 解读 |
| 成长线 Story | 剧情节点 + 现实活动时间线 | 动画 + 公开资料 |
| 音乐 Discography | 9 张单曲 + 3 张专辑，可按类型筛选 | 公开资料 |
| 卡面图鉴 Cards | 16 张官方卡面，按稀有度筛选、点击看大图、切换特训前/后 | Bestdori |
| 留言板 Letters | 本地留言（localStorage），不上传 | — |
| 官方入口 Links | 官网 / 动画官网 / X / YouTube | — |

后续可扩展：歌单试听页、成员关系图、Live 年表、生日企划专题、中日双语切换。

## 4. 内容策略

1. **资料必须可溯源**：生日 9/8、身高 160cm、声优立石凛、羽丘女子学园高一——来自官方角色页；角色 ID 37、成员色 #FF8899、卡面与实装日期——来自 Bestdori。
2. **官方原文 + 中文翻译并列**：既可信，也方便中文读者。
3. **区分「官方设定」和「个人解读」**：性格卡带标签，避免把脑补当官方。
4. **剧情与现实分线**：成长线里「剧情 ①②③④」与真实年份节点分开标注。
5. **卡面即内容**：16 张卡面本身就是最好的素材，配上实装日期与稀有度就是一条天然的时间线。

## 5. 设计方向

- **色彩**：主色用官方成员色 #FF8899（珊瑚粉），辅助色水色 #7fd8e8（乐队主题色），渐变贯穿全站。
- **气质**：明亮、轻快、带一点偶像感，但用深色文字与克制留白压住甜度。
- **动效**：滚动淡入、均衡器、漂浮音符、立绘呼吸感、卡面悬浮放大；全部遵守 prefers-reduced-motion。
- **主题**：白天 / 深夜两套配色，选择会被记住。
- **字体**：不依赖网络字体，系统圆体优先，中日文混排不塌。

## 6. 技术方案

**纯静态三件套（HTML + CSS + 原生 JS）**，零依赖、零构建。卡面由一份 JS 数据文件驱动渲染，因此用 file:// 双击打开也能正常工作。

    anon/
    ├── index.html                  单页站点
    ├── assets/
    │   ├── css/style.css           样式与主题变量
    │   ├── js/main.js              交互：主题 / 筛选 / 灯箱 / 留言
    │   ├── data/anon-cards.js      站点读取的卡面数据（自动生成）
    │   ├── img/cards/              卡面原图 + thumbs/ 缩略图
    │   ├── img/standing/           透明底全身立绘
    │   └── favicon.svg
    ├── data/bestdori/
    │   ├── anon-chihaya.json       清洗后的角色 + 卡片数据（可编辑）
    │   └── raw/                    Bestdori API 原始 JSON 留档
    ├── scripts/
    │   ├── fetch_bestdori.py       从 Bestdori 下载资料与图片
    │   └── build_site_data.py      生成 assets/data/anon-cards.js
    └── README.md

什么时候该升级：

| 需求 | 建议方案 |
| --- | --- |
| 内容变多、多人协作写稿 | Astro / Next.js + Markdown 内容集合 |
| 作品与卡面可检索归档 | 现有 JSON 数据层 + 静态生成（雏形已具备） |
| 真正可用的留言板 | Vercel/Cloudflare Functions + 数据库，或嵌 Giscus |
| 多语言 | 抽出文案字典，按 ?lang= 或子路径切换 |

## 7. Bestdori 数据与素材

已抓取内容（角色 ID 37，乐队 MyGO!!!!!）：

| 项目 | 数量 | 位置 |
| --- | --- | --- |
| 卡面原图（特训前 / 特训后） | 27 张 | assets/img/cards/ |
| 卡面缩略图（webp 640px） | 27 张 | assets/img/cards/thumbs/ |
| 透明底全身立绘 | 16 张 | assets/img/standing/ |
| 卡片元数据（稀有度 / 属性 / 实装日期 / 卡名） | 16 张 | data/bestdori/anon-chihaya.json |
| 原始 API JSON（角色 / 卡片 / 乐队） | 3 份 | data/bestdori/raw/ |

稀有度分布：★5 × 6、★4 × 1、★3 × 5、★2 × 3、★1 × 1。

刷新素材（已存在的文件会跳过，加 --force 可重下）：

    python3 scripts/fetch_bestdori.py     # 需要联网
    python3 scripts/build_site_data.py    # 离线，重新生成站点数据

补充说明：bili_res037001（bilibili 联动卡）位于 CN 服资源目录，脚本会自动回退查找；
res037s01、res900037 在 Bestdori 上没有对应卡面文件，已自动跳过。

### Live2D 模型（已接入）

Bestdori 上的 Live2D 是**游戏拆包资源**，不是网页常见的格式：每个服装一套，清单文件 `buildData.asset`（Unity TextAsset，内容是 JSON）里记录模型、物理、贴图、动作、表情各自的真实文件名。脚本按清单抓齐后重新组装成标准 Cubism 2.1 的 `model.json`。

| 项目 | 数量 | 说明 |
| --- | --- | --- |
| 服装 | 3 套 | 私服（春）、制服（冬）、制服（夏） |
| 动作 | 每套 41 个 | `*.mtn.bytes` → 去掉 `.bytes` 即标准 `.mtn` |
| 表情 | 每套 28 个 | `*.exp.json` |
| 体积 | 约 6.6 MB | 存放在 `assets/live2d/<服装>/` |

刷新模型：`python3 scripts/fetch_live2d.py`（需要联网，产物清单写入 `assets/data/anon-live2d.js`）。

网页端用 pixi.js + pixi-live2d-display（Cubism 2 版）+ Live2D Cubism 2 Core 渲染，三者都从 CDN 加载。

几个必须知道的坑：

- **Cubism 2 是 2013 年前后的老格式**，官方 CDN 上已经没有对应核心，现在用的是社区镜像 `cdn.jsdelivr.net/gh/dylanNew/live2d`。要长期上线，建议换自建 CDN 并确认 Live2D 的授权条款。
- **直接双击打开 index.html 时播放器无法工作**——浏览器会拦截 `file://` 下的模型文件读取，请用本地服务或线上地址。
- Bestdori 的清单没有保留动作分组（idle / tap 等），脚本统一放进 `idle` 组，由站点按索引调用。
- Cubism 2 的 `getLocalBounds()` 在第一帧之后才给出真实几何，因此播放器会先摆一次、再量一次重新取景。
- 作者样式会盖过浏览器默认的 `[hidden]{display:none}`：`.l2d-fallback` 这类元素必须显式写 `[hidden]{display:none}`，否则备用图会一直盖在画布上。

### 3D 模型（目前不可行）

结论：**能下载，但不能直接用**。

- Bestdori 的工具里只有 Live2D 查看器（另有资源浏览器 AssetExplorer、剧情查看器、音乐播放器等），**没有 3D 模型查看器**。
- 游戏里的 3D / SD 模型是 Unity 资源包（AssetBundle），`sdAssetBundleName`（爱音为 `00037`）只是索引名，模型本身不是 glTF/VRM 这类网页可渲染格式。
- 要放进网页，需要额外做一条转换流水线：UnityPy 解包 → 提取网格/材质/骨骼/贴图 → 转成 glTF → 用 three.js 渲染。工程量比 Live2D 大一个量级，而且转换质量、动画（动作、表情、口型）都需要单独验证。

如果确实要做，建议单独立项，先跑通「一个模型 + 一个待机动作」的最小闭环，再考虑批量。

## 8. 版权与合规（重要）

- 卡面、立绘、音乐、Logo 版权归 **BanG Dream! Project / Bushiroad** 所有，本站仅作个人学习与自用演示。
- 图片通过 Bestdori 获取（Bestdori 是粉丝资料站，非官方），**公开上线前请自行确认授权范围**。
- 若要公开：建议改用自己绘制的应援图 + 文字介绍，阅读 Bushiroad 的二次创作指引，保留页脚的非官方声明，不要提供音乐下载。
- 页脚与卡面区已内置来源与版权说明，请勿删除。

## 9. 本地预览

直接双击 index.html；或起一个本地服务：

    cd /home/srakhiumeow/anon
    python3 -m http.server 5173

浏览器打开 http://localhost:5173

## 10. 版本管理

项目用 Git 管理，**`data/` 目录不入库**（已在 `.gitignore` 中排除）——那里是通过 Bestdori 抓取的原始数据与中间产物，体积较大且可随时重新生成。

站点实际读取的 `assets/data/anon-cards.js` 是入库的，所以即使没有 `data/`，克隆下来也能直接打开页面；需要重新抓取时再执行 `scripts/` 下的两个脚本即可。

远端仓库：**https://github.com/SrakhiuMeow/anon-fansite**（私有，SSH 地址 `git@github.com:SrakhiuMeow/anon-fansite.git`）

新增或修改内容后：

    git add -A
    git commit -m "说明这次改了什么"
    git push

## 11. 部署（Vercel）

线上地址：**https://anon-chihaya-fansite.vercel.app**（Vercel 项目名 `anon-chihaya-fansite`）

仓库已连接 Vercel，**推送到 `main` 分支会自动部署到生产环境**，不用再手动跑命令。手动触发（例如改完还没提交）时也可以用：

    vercel deploy --prod --yes

换一台机器时先关联项目：

    vercel link --project anon-chihaya-fansite

部署范围由 `.vercelignore` 控制：只发布站点本身（`index.html`、`assets/`），`data/`、`scripts/`、文档与仓库文件都不上传。

有一个容易踩的坑：规则必须写成 `/data/` 这样的根目录锚定写法。写成 `data/` 会匹配任意层级的 data 目录，把 `assets/data/anon-cards.js` 一起排除掉，线上卡面图鉴就会加载不出来。**`.vercelignore` 和 `.gitignore` 两处都要注意**——Git 方式的部署会同时参考 `.gitignore`。

## 12. 后续路线图

**Phase 1 · 内容打磨**：补全曲名读法、给成长线加动画话数标注、卡面再按属性/年份分层筛选。

**Phase 2 · 素材扩充**：接入 Bestdori 的歌曲与 Live 数据、补充 3D 模型缩略图、为每张卡面写中文评注。

**Phase 3 · 功能扩展**：生日倒计时专题页（9/8 自动换视觉）、本地收藏喜欢的卡面、中日切换。

**Phase 4 · 上线**：绑定域名、静态托管 + HTTPS、接入统计，并在分享平台做一次首发。
