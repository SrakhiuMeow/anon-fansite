# 内容来源与核验记录

## 官方入口、音乐作品与商品渠道（2026-09-30 补充）

本轮按需求扩充官方入口、音乐作品信息与跨境购买渠道，并删除正文中的前置来源说明，只保留页末“每一份喜欢，都有出处”的来源区。以下链接均为 2026-09-30 实际访问确认。

### 官方入口

| 入口 | 地址 | 说明 |
| --- | --- | --- |
| MyGO!!!!! 官方站 | https://bang-dream.com/mygo | 由官方站页面重定向到 `https://bang-dream.com/artist/mygo/` |
| TV 动画官网 / 剧场版官网 | https://anime.bang-dream.com/mygo/ · https://mygo-movie.bang-dream.com/ | 剧场版前篇《春の陽だまり、迷い猫》2024-09-27、后篇《うたう、僕らになれるうた & FILM LIVE》2024-11-08 上映 |
| Ave Mujica 动画官网 / 官方站 | https://anime.bang-dream.com/avemujica/ · https://bang-dream.com/artist/avemujica/ | 续篇动画 2025-01-02 至 2025-03-27 播出，全 13 话 |
| MyGO!!!!! × Ave Mujica 官方 B 站 | https://space.bilibili.com/1459104794 | 账号名 `MyGO_AveMujica`，简介写明为「MyGO!!!!!」与「Ave Mujica」的官方账号；地址取自官方站社交链接 |
| BanG Dream! 国服官方 B 站 | https://space.bilibili.com/3546844774796156 | 账号名 `BanGDream_CN`；地址取自官方站页脚社交图标 |
| 官方配信入口 | https://bio.to/bio_mygoDG | 官方站「楽曲配信リンク」指向的流媒体汇总页 |
| 手游官网 | https://bang-dream.bushimo.jp/ · https://game.bilibili.com/bangdream/ | 分别为日服与国服官网 |
| X / YouTube / Instagram / TikTok | https://x.com/bang_dream_mygo · https://www.youtube.com/@bang_dream_mygo · https://www.instagram.com/bang_dream_official_/ · https://www.tiktok.com/@bang_dream_music | 沿用官方站社交区块给出的地址 |

### 音乐作品

- 曲目、发售日与封面来自官方站 [ディスコグラフィ](https://bang-dream.com/discographies/?artist=mygo)；每个发行的详情页列出收录曲与封面，页面数据与卡片一致。封面抓取脚本记录每个编号与图片地址，快照留在不入库的 `data/discography/raw/`。
- 读法（当て字 曲名的读法）核验来源：
  - [アニメイトタイムズ「MyGO!!!!!」楽曲名（読み方）まとめ](https://www.animatetimes.com/news/details.php?id=1761101185)：2026-03-31 更新，逐曲列出读法，涵盖本次全部单曲、专辑与主要收录曲。
  - [ORICON NEWS：5th シングル「端程山」](https://www.oricon.co.jp/news/2322289/full/)：明确写出标题读法为「パノラマ」。
  - [HMV 商品页（9th シングル「世点彩」）](https://www.hmv.co.jp/news/article/260807136/)：写作「世点彩（せぴあ）」，与赛事/媒体转述一致。
  - 日文维基百科[《MyGO!!!!!のディスコグラフィ》](https://ja.wikipedia.org/wiki/MyGO!!!!!のディスコグラフィ)记录 1st 单曲「迷星叫（まよいうた）」，用于交叉核对「当て字 曲名」这一特色说法。
- 站内采用的读法：迷星叫（まよいうた）、音一会（おといちえ）、壱雫空（ひとしずく）、砂寸奏（さすらい）、回層浮（かいそう）、端程山（ぱのらま）、聿日箋秋（いちじつせんしゅう）、往欄印（おうらい）、静降想（さいれんと）、世点彩（せぴあ）、迷跡波（めいせきは）、跡暖空（みちのく）、致並跡（ちへいせん）。
- YouTube 入口指向官方频道 `MyGO!!!!!`（`UC80p_16pSSHA8YmtCVdX51w`）与官方「バンドリちゃんねる☆」发布的 MV、动画 OP 与试听视频，链接逐条用 YouTube oEmbed 接口确认可用。9th 单曲「世点彩」2026-11-11 才发售，站内没有可核验的 MV，因此给出官方检索入口。
- B 站入口使用官方账号视频检索地址 `https://space.bilibili.com/1459104794/search/video?keyword=…`，只指向官方账号自身的投稿，不引用第三方搬运。

### 商品渠道

- 官方商店目前不配送日本以外地区，因此每件商品除官方页面外，另加淘宝与 bilibili 会员购的**检索入口**：`https://s.taobao.com/search?q=…` 与 `https://mall.bilibili.com/neul-next/index.html?page=flow_searchResult&keyword=…`。
- 会员购检索地址由站点自身搜索行为取得（在 mall.bilibili.com 搜索后跳转到 `page=flow_searchResult&keyword=…`），并在浏览器中重新打开确认能显示搜索结果。检索词保存在 `assets/data/anon-official.js` 的 `marketKeyword` 字段。
- 站内不记录任何第三方卖家的价格与库存，也不代购或参与结算；页面说明提示访客自行核对卖家、版本与价格。

### 萌战应援海报

- 海报为本站自制：版式、配色与文案均由本站撰写，画面使用站内已收录的官方立绘（`assets/img/standing/`），**不是赛事官方海报**，也没有复制任何赛事视觉素材。
- 海报条目与荣誉表一一对应（年份、赛事、成绩），成绩文字沿用已有核验记录；出处链接沿用各荣誉条目的 `source`。
- 页面文案明确标注「本站自制的战报海报……并非赛事官方海报」，避免与赛事公告混淆。

### 删除前置来源说明

按要求只保留页末来源区，本轮删除了以下页面内来源段落：角色资料的「资料核对」段、Live2D 素材来源段、成长线的剧情说明段、卡面图鉴的素材来源与版权提示块、商品快照说明与商品核验日期行、萌娘百科摘编署名段，以及灯箱内的图片来源说明。相关出处仍完整保留在页末来源区、本文件与数据文件注释中。

## 萌娘百科：角色设定与社区荣誉

- 核验日期：2026-09-29。
- 原始页面：[萌娘百科《千早爱音》](https://zh.moegirl.org.cn/千早爱音)。
- 核验修订版本：`8692952`，页面 ID 为 `565339`；见[固定版本](https://zh.moegirl.org.cn/index.php?title=千早爱音&oldid=8692952)及[编辑历史与贡献者](https://zh.moegirl.org.cn/index.php?title=千早爱音&action=history)。
- 站点数据：`assets/data/anon-wiki.js`，通过 `window.ANON_WIKI` 提供。

核验时以普通 GET 请求读取主站公开 HTML，确认页面配置中的 `wgCurRevisionId` 与正文的“简介”“角色荣誉”章节。通用网页提取工具只返回需要 JavaScript 的提示；主站 HTML 实际可公开读取。MediaWiki API 返回 `Unauthorized API call`，因此本站采用人工核验后的静态快照，不依赖该 API。未使用镜像站内容冒充主站，也未绕过登录或访问挑战。

网站简介和特点卡片为短篇归纳改写，保留角色身份、交流与行动特点、练习经历及乐队分工，不转载大段原文，不把粉丝玩梗当作官方设定。基础个人信息另以 BanG Dream! 官方资料为准。

### 荣誉的记录边界

荣誉区展示社区投票与评审结果，不属于 BanG Dream! 官方授予的角色头衔。年份按赛事赛季记录，不等同于获奖消息的发布日期。

| 赛季 | 成绩 | 核验范围 |
| --- | --- | --- |
| 2023 | 国际最萌大会新星女子组春季优胜、赛季冠军 | 主站记载，并以赛事账号荣誉动态交叉核验 |
| 2023 | r/anime Awards 最佳喜剧角色评审奖 | 主站记载，并以赛事官方结果交叉核验 |
| 2024 | 国际最萌大会恒星女子组黄玉项链、赛季冠军 | 主站记载，并以赛事账号荣誉动态交叉核验 |
| 2025 | Bilibili Moe 新番萌组亚军 | 主站条目记载 |
| 2025 | 第十一届天使动漫萌战冠军 | 主站条目记载 |
| 2025 | 国际最萌大会全明星赛优胜者 | 主站条目记载；图注标明女子组 |
| 2026 | Bilibili Moe 萌组冠军 | 主站条目记载 |

交叉核验来源：

- [r/anime Awards 2023 官方结果页](https://animeawards.moe/results/2023)：`Comedic Character` 项下为 `Anon Chihaya`、`Jury Winner`。通过该官方结果页的搜索引擎索引核对。
- [“国际最萌大会”赛事账号荣誉动态](https://www.bilibili.com/opus/1096871970961620995)：2025-08-03 发布，列有 2023 春之王冠、2023 神圣头环、2024 黄玉项链、2024 神圣皇冠。其中冠军属于 **2024 赛季**，不能改记为 2025 赛季。通过该赛事账号动态的搜索引擎索引核对。

### 摘编许可与署名

核验日的[萌娘百科现行著作权信息](https://zh.moegirl.org.cn/萌娘百科:著作权信息)明确，除特殊注明外，文本使用 **CC BY-NC-SA 4.0**，而非旧搜索缓存中出现的 3.0。转载或引用应提供完整原页面链接，并明确注明“萌娘百科”。

本站据此摘编的简介、特点和社区荣誉说明，以“萌娘百科贡献者；本站归纳改写”署名，按[知识共享署名—非商业性使用—相同方式共享 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)提供。页面应保留原条目、编辑历史和许可链接，并明确做过归纳改写。

此许可仅针对相应摘编文本，不代表角色图片、卡面、Live2D 文件、音频或商标也按同一许可提供；这些素材应分别保留其权利人与来源说明。

## 官方资料、商品与 Bestdori 素材

核验日期：2026-09-29。官方快照位于 `assets/data/anon-official.js`。

- [BanG Dream! 官方门户角色页](https://bang-dream.com/artist/mygo/chihaya-anon/)：吉他担当、声优、转学经历与性格简介。
- [游戏官方角色页](https://bang-dream.bushimo.jp/character/mygo/chihaya-anon/)：高一 A 班、生日、星座、喜好食物、不喜食物与兴趣。页面中文为归纳翻译。
- [武士道官方爱音专区](https://bushiroad-store.com/collections/anon)：下列商品页核实名称、含税日元价格、原图与购买入口。可购状态另由各商品公开 `.js` 接口的 `available` 核实，未把缺少库存字段当作在售。

| 商品 | 核验日含税价 | 快照状态 | 官方页面 |
| --- | --- | --- | --- |
| 9th LIVE 爱音立牌 | 1,760 JPY | 在售 | https://bushiroad-store.com/products/2000302490279 |
| Night Owl 爱音立牌 | 1,760 JPY | 在售 | https://bushiroad-store.com/products/2000223242735 |
| PalVerse Palé. 爱音手办 | 3,300 JPY | 在售 | https://bushiroad-store.com/products/2000238407938 |
| 6th LIVE 爱音立牌 | 1,760 JPY | 在售 | https://bushiroad-store.com/products/2000183763820 |
| Night Owl 爱音钥匙扣 | 880 JPY | 在售 | https://bushiroad-store.com/products/2000223242834 |
| Voyage 爱音迷你玩偶 | 1,980 JPY | 预售，预计 2026-10-16 发售 | https://bushiroad-store.com/products/2000296652912 |

商品图片保留原图与原水印，存于 `assets/img/goods/`，数据中保留 `originalImage` 与 `originalName`。Shopify 接口原始 `price` 不直接作为展示价格；展示以商品页含税标价为准。价格、库存、配送范围均可能变化，网站明确显示快照日期及商店结算优先说明。没有购买或下单行为。

### Bestdori 与 Live2D

- [Bestdori 角色 37 API](https://bestdori.com/api/characters/37.json)：千早爱音、成员色与默认服装。Bestdori 是粉丝资料站，不是官方授权声明。
- [Bestdori 卡片数据](https://bestdori.com/api/cards/all.5.json)：沿用原仓库已下载的 16 张卡片、27 个卡面版本与立绘，不声称收录全部最新卡片。
- 3 套模型沿用仓库同源素材，本次核验默认服装资源：`https://bestdori.com/assets/jp/live2d/chara/037_casual-2023_rip/anon_casual-2023.moc`，通用动作：`https://bestdori.com/assets/jp/live2d/chara/037_general_rip/smile01.mtn`。实际返回有效文件。
- 模型为 Cubism 2.1：`.moc`、`.mtn`、`.exp.json`；从 `buildData.asset` 重建标准 model.json。上游没有浏览器跨域所需的 CORS 响应头，因此使用仓库本地素材，不让访客直接跨域加载。
- 本次将 `idle` 分组限定为待机动作；全部 41 个可触发动作移入 `reaction`，避免随机自动播放哭泣或生气。

运行时：PixiJS 6.5.10、pixi-live2d-display 0.4.0（MIT），与 Live2D Cubism 2 Core（专有许可，不能标为 MIT）。Core 采用插件文档推荐镜像的固定提交 `fd9fd400845e9a00bb194fdac0b6635c753a1e8a`，所有 CDN 文件均加 SRI 校验与加载超时；源码内记录准确 URL。参见 [pixi-live2d-display 官方文档](https://github.com/guansss/pixi-live2d-display)、[Live2D 许可说明](https://www.live2d.com/en/sdk/license/)及[原 SDK 说明](https://github.com/dylanNew/live2d/blob/fd9fd400845e9a00bb194fdac0b6635c753a1e8a/webgl/Live2D/ReadMe.txt)。运行时许可与游戏角色素材权利彼此独立。

### bdon.moe / Our Notes 新增模型

核验日期：2026-09-30（UTC）。入口为 [Moenotes Live2D 浏览器](https://bdon.moe/tools/live2d)。其公开[数据说明](https://github.com/StarMoe-org/moenotes/blob/main/docs/live2d-viewer.md)与[地址配置](https://github.com/StarMoe-org/moenotes/blob/main/src/config/assets.ts)明确列出模型索引和内容哈希资源位置。本次合并[剧情索引](https://storage.bdon.moe/moenotes/models.json)的 7 项爱音模型与[演奏站索引](https://assets.bdon.moe/chart-site/models.json)的 10 项，按 ID 合并为 10 项，再排除 1 项同款低清副本，收录以下 9 套。原有 3 套 Bestdori 模型继续保留，全站共 12 套。选项名称根据上游模型 ID 翻译，不冒充游戏内正式服装名。

| 站内选项 | 上游模型 ID | 动作 / 表情 | 本地文件体积 |
| --- | --- | --- | --- |
| Our Notes · 私服（春） | `adv_live2d_anon_002_casual_spring_01` | 66 / 36 | 约 10.3 MiB |
| Our Notes · 私服（眼镜） | `adv_live2d_anon_002_casual_spring_01_glasses` | 66 / 36 | 约 10.6 MiB |
| Our Notes · 演出服 | `adv_live2d_anon_002_live_01` | 66 / 36 | 约 11.5 MiB |
| Our Notes · 居家服（眼镜） | `adv_live2d_anon_002_roomwear_01_glasses` | 66 / 36 | 约 12.9 MiB |
| Our Notes · 居家服 | `adv_live2d_anon_002_roomwear_01` | 66 / 36 | 约 13.1 MiB |
| Our Notes · 制服（夏） | `adv_live2d_anon_002_school_summer_hs_1st` | 66 / 36 | 约 20.4 MiB |
| Our Notes · 制服（冬） | `adv_live2d_anon_002_school_winter_hs_1st` | 66 / 36 | 约 26.9 MiB |
| Our Notes · 制服（冬·眼镜） | `adv_live2d_anon_002_school_winter_hs_1st_glasses` | 66 / 36 | 约 27.0 MiB |
| Our Notes · 吉他演奏（舞台） | `live2d_anon_002_live_01` | 9 / 0 | 约 12.2 MiB |

- 相同 ID 优先采用剧情索引；仅演奏站提供的无眼镜居家服、吉他演奏从演奏站获取。`live2d_anon_002_live_01_low` 为同款演奏低清副本，保留标准画质款即可；不以“千早愛音”这一相同角色名称去重，也不合并眼镜和无眼镜版本。生成清单的 `bdonCatalog` 记录收录与排除项。
- 清单地址为对应索引根目录下的 `models/<上游模型 ID>.json`；各模型目录的 `source.json` 保存完整来源、原始清单 SHA-256、上游依赖引用及本地生成文件校验值。
- 模型为 `.moc3`（上游 `mocVersion: 5`），剧情款各配 2 张 PNG 贴图、演奏款配 3 张。站点同时支持旧版 Cubism 2 与新版模型；新版使用 Live2D 官方 [Cubism Core](https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js)，其专有许可独立适用。
- 上游没有直接提供标准 `model3.json`，而是在 Unity prefab 数据中保存动作、表情和物理。本项目脚本独立将 `CubismFadeMotionData` 的 Hermite 关键帧与切线还原为 `.motion3.json` 三次贝塞尔曲线，将 `CubismExpressionData` 转为 `.exp3.json`，将 `CubismPhysicsRig` 转为 `.physics3.json`。参数 ID、数值、淡入淡出和混合方式来自原素材，没有根据名称臆造表情参数。
- 转换依据为 Live2D 官方 [Cubism 文件格式规范](https://github.com/Live2D/CubismSpecs/tree/master/FileFormats)及[表情混合枚举定义](https://github.com/Live2D/CubismUnityComponents/blob/develop/Assets/Live2D/Cubism/Framework/CubismParameterBlendMode.cs)。未复制 Moenotes / ournotes-player 的播放器实现。网页采用标准 Cubism Web 渲染，不复刻 Unity 的 URP 光照和 MotionSync 语音分析，不声称与游戏最终画面完全相同。
- 剧情款的 `idle` 仅含默认待机 `mtn_idle01_C`，`reaction` 收录全部 66 个动作。聊天语义通过每套服装的 `reactions` 映射绑定真实动作和表情；例如害羞使用思考姿态与 `exp_shy01`，眨眼使用 `mtn_wink01_C` 与微笑表情，不伪造不存在的动作或表情名。
- 吉他演奏款原数据有 9 个动作，无独立表情、无物理子组；待机为 `mtn_idle_01`，面板提供舞台动作、收尾、两组各三段演奏。聊天语气映射到真实舞台动作，普通问候、分享和鼓励也能自动播放：开心优先带笑眼曲线的演奏，认真回应使用较轻柔演奏。动作自带部分脸部变化，但不把它们声称为独立哭泣、生气等表情；徽章显示实际动作名称。非待机动作播完后由播放器自动回到待机。
- 重跑：`node scripts/fetch_bdon_live2d.cjs --proxy http://127.0.0.1:7897`；缓存离线转换：`node scripts/fetch_bdon_live2d.cjs --offline`。联网运行默认刷新两个索引及模型清单，内容哈希资源复用缓存，`--force` 可全部重新下载。缓存位于忽略入库的 `/data/bdon/`，所有部署所需文件位于 `assets/live2d/`。每个上游文件都验证解压后长度与 SHA-256；重跑旧 Bestdori 抓取脚本也会保留新增选项与去重清单。

Moenotes 是非官方粉丝资料站；素材权利仍归 BanG Dream! / Bushiroad 等原权利人，读取公开素材不构成版权转让或商业授权。来源链接保留在站点界面及模型清单中。

新版 Core 原文件保存在 `assets/vendor/live2dcubismcore-5.1.0.min.js`，实测版本 5.1.0、支持最高 MOC 版本 5；来源为前述 Live2D 官方分发地址。SHA-256 为 `25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f`，完整官方许可随文件保存在 `assets/vendor/live2dcubismcore-LICENSE.txt`。模型播放器采用 0.4.0 的 `index.min.js` 全格式包，同时注册两代 Core；已在浏览器验证新旧十二套模型的加载、对话映射与演奏款九个真实动作。

### 免费全站字体

全站统一采用 [Noto Sans SC](https://fontsource.org/fonts/noto-sans-sc/about) 的 700 粗体，来源固定为 `@fontsource/noto-sans-sc@5.3.0`。字体按 **SIL Open Font License 1.1** 分发，原始版权与许可在 `assets/fonts/noto-sans-sc/LICENSE`，字节与来源清单在同目录 `manifest.json`，维护说明在 `README.md`。101 个原版 WOFF2 分段共 2,461,192 字节，按 `unicode-range` 从本站加载；未修改字体二进制，CSS 仅采用独立别名并指向本地资源。正文、标题、导航、卡片、数据标签、输入框、控件、聊天与密码弹窗使用统一字体；罕见字与彩色 Emoji 可由系统后备字体显示。浅色和夜间主题分别调整正文、辅助文字、链接和有色按钮的文字对比。

聊天为非官方同人演绎，不是动画或游戏台词。本地模式使用本站原创的关键词回应，不上传聊天；可选 DeepSeek 模式由 Vercel 服务端发送本条消息及最近的 AI 对话上下文到 DeepSeek，驱动文字与白名单表情动作。聊天仅保留在页面内存，刷新或清空即重置；本站代码不持久存储聊天。AI 回复可能产生错误，不作为官方角色资料或商品信息来源。配置与服务提供商文档见 [DeepSeek 接入说明](DEEPSEEK.md)。留言板仍仅保存在访客浏览器。
