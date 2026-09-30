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
| Live2D | 私服（春）、制服（冬）、制服（夏）3 套服装；每套收录 41 个动作、28 个表情，提供常用动作与表情按钮 |
| 互动对话 | 根据输入关键词生成本站原创同人回应，并触发对应模型动作与表情 |
| 原有栏目 | 保留角色解读、成长线、音乐、官方入口、主题切换及本地留言板 |

商品数据为核验快照，价格、库存与配送范围以官方商店页面及结算结果为准。社区荣誉属于粉丝赛事或评审结果，不是 BanG Dream! 官方授予的角色头衔；卡面也不宣称覆盖所有最新实装。

对话由浏览器内的关键词规则处理，**不是生成式 AI，也不是官方台词**。聊天内容不上传、不持久保存。留言板和主题偏好保存在当前浏览器的 `localStorage`，不会同步至其他设备。

## 本地运行

网站使用纯静态 HTML、CSS 和原生 JavaScript，无需 npm 安装或构建。在仓库根目录启动 HTTP 服务：

```sh
python3 -m http.server 5173
```

打开 [http://localhost:5173](http://localhost:5173)。Windows 可按本机 Python 安装情况将 `python3` 换成 `py` 或 `python`。

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
assets/live2d/                 三套 Cubism 2.1 模型及动作、表情、贴图
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

两个抓取脚本默认跳过已存在文件，加 `--force` 可重新下载；资源会按日服、国服目录尝试，缺失素材不会被当作有效图片。重新抓取后的数量取决于上游实际数据，提交前应重新检查。Live2D 的 `idle` 分组仅放待机动作，41 个可触发动作放在 `reaction` 分组，避免待机时随机播放哭泣或生气。

## 检查与运行时

部署前在仓库根目录运行以下无依赖 Node.js 检查：

```sh
node scripts/check-site.cjs
node scripts/test-dialogue.cjs
```

前者检查页面引用、本地文件、图片格式、数据字段与脚本语法；后者检查关键词回应以及动作、表情与三套模型资源的对应关系。两者均为离线检查，浏览器布局、实际模型渲染、外链可达性和最新库存仍需另行验证。

Live2D 使用固定版本的 **PixiJS 6.5.10**、**pixi-live2d-display 0.4.0**，以及固定提交 `fd9fd400845e9a00bb194fdac0b6635c753a1e8a` 的 Cubism 2 Core 镜像。CDN 脚本使用 SRI 完整性校验，加载器设置超时、备用 CDN 入口和页面重试按钮。网络、CDN 或 WebGL 故障时会显示备用内容与状态提示，文字回应仍可使用；这些措施不保证外部服务始终可用。

## 部署与忽略规则

仓库已连接 Vercel，推送到 `main` 后自动部署至 [https://anon.srakhiumeow.top](https://anon.srakhiumeow.top)。`vercel.json` 使用静态部署配置，构建命令为空，输出目录为仓库根目录。部署完成后刷新页面查看更新；若旧资源仍被缓存，可强制刷新。

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

PixiJS 和 pixi-live2d-display 使用 MIT 许可；Live2D Cubism 2 Core 使用其专有许可，不能与前两者统一标为 MIT。具体来源、官方商品链接、百科版本和运行时许可入口见 [docs/SOURCES.md](docs/SOURCES.md)。
