# 千早爱音应援站

千早爱音（千早 愛音 / Anon Chihaya）的非官方粉丝网站，汇集官方角色资料、官方商品、卡面图鉴、Live2D 互动与萌娘百科摘编。

- 线上地址：[anon.srakhiumeow.top](https://anon.srakhiumeow.top)
- 仓库：[SrakhiuMeow/anon-fansite](https://github.com/SrakhiuMeow/anon-fansite)
- 来源、核验范围与许可：[docs/SOURCES.md](docs/SOURCES.md)

## 当前功能

| 模块 | 内容 |
| --- | --- |
| 官方资料 | BanG Dream! 官方角色页的身份、学校、生日、喜好与简介，附原始出处 |
| 官方商品 | 6 件商品的图片、含税日元价格和购买链接；2026-09-29 快照中 5 件在售、1 件预售 |
| 角色百科 | 萌娘百科简介与特点摘编、7 条社区荣誉记录，注明来源、核验范围与许可 |
| 卡面图鉴 | 保留原有 16 张卡片、27 个特训前后卡面版本，支持筛选、灯箱和版本切换 |
| Live2D | 原有 3 套 Bestdori 与 9 套 Our Notes，共 12 套；剧情款含私服、制服、居家服及眼镜版本，舞台款支持 9 个吉他演奏动作；提供模型缩放与还原 |
| 互动对话 | DeepSeek 流式回复按语气分段切换表情，动作就绪后渐进显示对应文字；保留密码锁、本地互动、停止及清空 |
| 聊天阅读 | 自托管免费 Noto Sans SC 700 粗体，统一正文、控件与弹窗，浅色和夜间主题均加强文字对比 |
| 原有栏目 | 保留角色解读、成长线、音乐、官方入口、主题切换及本地留言板 |

商品数据为核验快照，价格、库存与配送范围以官方商店页面及结算结果为准。社区荣誉属于粉丝赛事或评审结果，不是 BanG Dream! 官方授予的角色头衔；卡面也不宣称覆盖所有最新实装。

本地互动在浏览器内匹配关键词，不上传聊天内容。配置服务端密钥后可使用 DeepSeek AI：本条消息及最多最近 5 轮成功的 AI 对话经 Vercel 服务端发送到 DeepSeek，流式回复同时触发表情和动作。两种模式均为非官方同人演绎，聊天历史仅保留在当前页面内存；刷新、清空或切换模式会重置 AI 上下文。本站代码不将聊天写入数据库、浏览器持久存储或应用日志，服务提供商的数据处理以其政策为准。留言板和主题偏好仍保存在当前浏览器的 `localStorage`。

AI 对话的表情演出偏向积极、开心，日常优先微笑、鼓励和轻快眨眼；缺失或未知情绪标签也回退为微笑。安慰时以温柔鼓励为主，明显沉重的话题仍可先认真倾听，再自然转为支持，不强行大笑。悲伤、生气仅在确有情境依据或明确演示要求时使用，不因访客提到负面词语就触发。

同一次 AI 回复可在自然语气转折时切换情绪。播放器按服装映射实际动作，预热常用资源，文字与动作按顺序展示，避免一批流事件导致表情快速覆盖。停止或重新锁定会取消尚未展示的文字和动作；网络已接收但还未展示完的轮次仍可停止。系统“减少动态效果”偏好下文字直接展示。分段情绪由模型判断，不能保证每次都准确还原角色。

**启用 AI：** 在 Vercel 项目环境变量中设置 `DEEPSEEK_API_KEY` 并重新部署。密钥仅在 `/api/chat` 服务端使用，禁止放入前端脚本或提交 Git。AI 默认启用密码锁，访客需在提示框输入站长提供的密码；刷新或手动锁定后需重新解锁，本地互动不受影响。默认密码仅保存服务端加盐摘要，可用 `CHAT_ACCESS_CODE` 覆盖；解锁验证不调用模型，每次聊天仍在服务端验密。完整配置、限流边界与验证步骤见 [DeepSeek 接入说明](docs/DEEPSEEK.md)。

AI 人格主体采用站长提供的 `anon.txt` 全文，人物经历、关系和称呼表原样接入服务端提示词；Live2D 情绪与输出协议单独保留。人格原文与文件哈希的回归检查用于避免导入遗漏或改写。

Live2D 控制区提供“跟随鼠标”开关，默认开启。关闭后恢复正向视线；开关偏好保存在当前浏览器，换装、重新加载与刷新后继续生效，不影响对话、动作和表情按钮。

模型区可在 50%–180% 范围内按 10% 步进放大、缩小，并一键还原到 100%；换装和窗口尺寸变化保留当前比例，暂停时也可缩放。Our Notes 的 8 套剧情模型各有 66 个动作与 36 个表情；吉他演奏款有 9 个舞台动作，无独立表情，聊天时保持舞台待机并明确提示“演奏姿态”。同 ID 跨索引仅导入一次，同款低清副本不重复加入，眼镜与无眼镜款分别保留。

## 本地运行

页面使用静态 HTML、CSS 和原生 JavaScript，无需 npm 安装或构建；可选 AI 接口使用 Vercel Node.js Function。在仓库根目录启动 HTTP 服务可测试页面与本地互动：

```sh
python3 -m http.server 5173
```

打开 [http://localhost:5173](http://localhost:5173)。Windows 可按本机 Python 安装情况将 `python3` 换成 `py` 或 `python`。

Python 静态服务器不运行 `/api/chat`，因此本地互动正常、AI 选项不可用。需要本地联调接口时使用 `vercel dev`，服务端环境变量配置见接入说明。

Live2D 需要通过 HTTP/HTTPS 读取模型，不能依赖双击 `index.html` 的 `file://` 方式运行。模型和图片随仓库部署；Live2D 运行时从 CDN 加载，因此该模块仍需要网络和支持 WebGL 的浏览器。

## 目录与内容维护

```text
index.html                     单页入口
assets/css/                    页面与互动模块样式
assets/js/                     原有交互、内容渲染、对话规则与 Live2D 播放器
assets/data/anon-cards.js      卡片与角色素材数据
assets/data/anon-live2d.js     Live2D 服装、动作与表情清单
assets/data/anon-official.js   官方角色与商品快照
assets/data/anon-wiki.js       萌娘百科摘编、荣誉与许可信息
assets/img/                    卡面、立绘与商品图片
assets/live2d/                 十二套新旧模型及动作、表情、贴图、物理与来源清单
assets/fonts/noto-sans-sc/     聊天使用的免费粗体字体分段与 OFL 许可
assets/vendor/                新版 Cubism Core 原文件及专有许可
scripts/                       素材抓取、数据生成与离线检查脚本
docs/SOURCES.md                内容来源、版本与核验说明
data/bestdori/                 可重新抓取的原始数据和中间产物，不入库
```

更新官方资料或商品时，核对官方原页、含税价格和可购状态，再修改 `assets/data/anon-official.js`、对应商品图片及 `checkedAt`。不要将未知库存标为在售，也不要直接把 Shopify 接口的税前内部金额用作展示价。保留商品原名、原图地址与官方购买链接。

更新百科内容时，同步修改 `assets/data/anon-wiki.js` 和 [docs/SOURCES.md](docs/SOURCES.md)，保留页面修订版本、贡献者署名及许可链接；赛事赛季与消息发布日期应分别核对。

### Bestdori 抓取与生成

原有三个 Python 脚本仍可使用。运行抓取需要 Python 3；如需生成卡面 WebP 缩略图，安装 Pillow：

```sh
python3 -m pip install Pillow
python3 scripts/fetch_bestdori.py
python3 scripts/build_site_data.py
python3 scripts/fetch_live2d.py
```

- `fetch_bestdori.py` 抓取角色资料、卡面与立绘，原始 JSON 和清洗结果写入 `data/bestdori/`，图片写入 `assets/img/`。
- `build_site_data.py` 根据本地清洗结果生成 `assets/data/anon-cards.js`，此步骤可离线执行。
- `fetch_live2d.py` 根据 Bestdori 的 `buildData.asset` 清单下载资源，组装 Cubism 2.1 `model.json` 并生成 `assets/data/anon-live2d.js`。
- `node scripts/fetch_bdon_live2d.cjs` 合并 bdon.moe 剧情与演奏两个索引，按模型 ID 发现爱音全部不同款式；排除有标准版的同款 `_low` 副本，将真实 Unity 曲线、表情与物理转换为标准 Cubism 文件。索引与模型清单每次联网刷新，内容哈希资源复用缓存；加 `--offline` 可从 `/data/bdon/` 重建。两种模型抓取脚本会保留另一来源的服装选项与 bdon 去重清单。
- `node scripts/fetch_chat_font.cjs` 重新获取固定版本 Noto Sans SC 粗体与许可，校验上游字体哈希。访客加载本地 `unicode-range` 字体分段，无需请求字体 CDN。

两个抓取脚本默认跳过已存在文件，加 `--force` 可重新下载；资源会按日服、国服目录尝试，缺失素材不会被当作有效图片。重新抓取后的数量取决于上游实际数据，提交前应重新检查。Live2D 的 `idle` 分组仅放待机动作，41 个可触发动作放在 `reaction` 分组，避免待机时随机播放哭泣或生气。

## 检查与运行时

部署前在仓库根目录运行以下无依赖 Node.js 检查：

```sh
node scripts/check-site.cjs
node scripts/test-dialogue.cjs
node scripts/test-chat-api.cjs
node scripts/test-chat-client.cjs
node scripts/test-live2d-actions.cjs
node scripts/test-live2d-viewer.cjs
node scripts/test-bdon-import.cjs
```

站点检查覆盖页面引用、本地文件、图片格式、数据字段与脚本语法；对话检查覆盖关键词回应与模型素材。AI 测试用模拟上游检查输入边界、流式解析、错误与取消等行为，不调用付费 API。浏览器布局、实际模型渲染、真实 API 联通、外链可达性和最新库存仍需另行验证。

Live2D 使用固定版本的 **PixiJS 6.5.10**、**pixi-live2d-display 0.4.0 全格式包**，以及固定提交 `fd9fd400845e9a00bb194fdac0b6635c753a1e8a` 的 Cubism 2 Core 镜像。新增 `.moc3` 使用同源保存的官方 **Cubism Core 5.1.0**，等待其 WASM 初始化后再加载模型。运行时脚本使用 SRI 完整性校验，CDN 加载设置超时与备用入口，并保留重试按钮。网络、CDN 或 WebGL 故障时会显示备用内容与状态提示，文字回应仍可使用；这些措施不保证外部服务始终可用。

## 部署与忽略规则

仓库已连接 Vercel，推送到 `main` 后自动部署至 [https://anon.srakhiumeow.top](https://anon.srakhiumeow.top)。`vercel.json` 保留空构建命令与仓库根输出目录，`api/chat.js` 自动部署为 Node.js Function；未配置密钥时仍可使用静态页面及本地互动。部署完成后刷新页面查看更新；若旧资源仍被缓存，可强制刷新。

```sh
git add -A
git commit -m "说明这次改了什么及原因"
git push origin main
```

`.vercelignore` 排除根目录原始数据、抓取与检查脚本、文档及本地工具目录。站点所需的 `index.html` 和 `assets/` 必须入库并参与部署。

**`.gitignore` 与 `.vercelignore` 中的原始数据规则必须写成 `/data/`。** 不带根目录锚定的 `data/` 会误排除 `assets/data/`，导致线上卡面、商品或其他数据无法加载。现有生成数据随仓库保存，运行网站不需要先执行抓取脚本。

## 来源与许可

本站与 BanG Dream!、Bushiroad、Bestdori 或萌娘百科没有官方关联。角色图片、商品图片、卡面、Live2D 素材及商标分别归其权利人所有；Bestdori 是粉丝资料整理站，不代表素材授权。请保留页面来源与权利声明。

萌娘百科摘编文本注明“萌娘百科贡献者；本站归纳改写”，按核验日的 **CC BY-NC-SA 4.0** 提供，并附原条目、编辑历史和许可链接。该许可不覆盖角色图片、模型或商标。

PixiJS 和 pixi-live2d-display 使用 MIT 许可；两代 Live2D Cubism Core 使用其专有许可，不能与前两者统一标为 MIT。聊天字体 Noto Sans SC 使用 SIL Open Font License 1.1，许可证随字体部署。具体来源、官方商品链接、百科版本和运行时许可入口见 [docs/SOURCES.md](docs/SOURCES.md)。
