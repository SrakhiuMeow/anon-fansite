# DeepSeek 角色对话接入

保留原静态站及本地关键词互动，另加同源 `/api/chat` Vercel Node.js Function。浏览器不会收到 DeepSeek API Key，也不直接访问 DeepSeek。

## Vercel 配置

1. 打开 [Vercel 控制台](https://vercel.com/dashboard)，选择关联 `anon-fansite` 仓库的网站项目。
2. 在项目 **Settings → Environment Variables** 新增下列变量，选择 **Production** 环境；只在需要测试预览部署时勾选 Preview。
3. 保存后，在 Deployments 重新部署最新版本，或等待下一次 Git 推送触发部署。环境变量不会自动应用到旧部署。
4. 刷新网站，聊天模式会显示 **DeepSeek AI**。服务检查不会调用模型，不消耗 DeepSeek 推理额度；只有发送 AI 消息才会请求模型。

| 变量 | 必需 | 作用 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | DeepSeek 控制台生成的 API Key，仅服务端读取 |
| `DEEPSEEK_MODEL` | 否 | 默认 `deepseek-flash`；可按 DeepSeek 当前可用模型填写，接口关闭思考模式以降低等待时间 |
| `CHAT_ACCESS_CODE` | 否 | 设置后，访客须填写站长提供的聊天口令才能调用 AI；口令只留在页面内存，刷新后重新输入 |

不要添加 `NEXT_PUBLIC_` 或 `VITE_` 前缀，不要把密钥放进 `index.html`、`assets/`、Git、留言板或对话框。`.env*` 已被 Git 与 Vercel 忽略。如需本地联调，使用 Vercel CLI 的 `vercel dev`，将本地密钥留在忽略的环境文件中。

## 对话与动作

- 模型以爱音的非官方同人角色口吻交流：中文、自然短句，承接话题，避免每轮重复自我介绍和固定问句；角色基础资料写在服务端提示词中。
- 每次传递最近 5 轮完整 AI 对话和当前输入。刷新、清空或切模式重置上下文；取消、失败或中断的轮次不进入后续上下文。
- DeepSeek 流式生成文本，先给出情绪标签。服务端将标签映射到现有三套服装共同支持的动作与表情；未知标签回退待机，模型不能指定代码、资源地址或任意模型参数。
- 没有密钥时仅本地互动；请求失败且未收到 AI 文字时，明确提示并使用本地预设。若已收到部分文字，则保留并提示中断，不混接预设台词。
- 支持停止回复、清空对话。沿用既有暂停动画、换装和鼠标跟踪开关。此版本提供文字对话，不含语音合成、声音克隆或口型音频同步。

## 对话人格的来源与校准

人格由服务端 `api/chat.js` 的 `SYSTEM_PROMPT` 指定，每次请求都与近期对话一同传给模型。事实依据是站内已核验的 `assets/data/anon-official.js`，并参考 [MyGO!!!!! 动画官方角色页](https://anime.bang-dream.com/mygo/character/anon/)与 [Ave Mujica 动画官方角色页](https://anime.bang-dream.com/avemujica/character/anon/)：前者明确其社交能力、行动力与追赶流行的特点，后者补充衣装、SNS担当以及愿意为朋友行动的特征。

提示词分为“官方事实、同人行为规则、中文表达习惯、情绪与动作协议、原创情景示例”五部分。行为规则将人物特点落实为可观察的回应：被夸时会小得意或害羞，尴尬时可能先逞强一句、随后承认不足并找办法；对同伴有牵挂，以仍需练习的新人的姿态交流，不扮演全能专家或说教式导师。回复通常为20至100字、1至3句，接住访客的具体话题，不机械重复吉他、固定问句或语气词，也不主动将访客设定为恋人。

这些行为规则及提示词内的夸赞、失落、练琴失误三组示例是本站原创演绎，不是官方台词或对角色内心的权威解释。模型可以即兴产生同人日常情境，但不能将其冒充原作情节或真实经历；询问身份和来源时应明确说明是非官方AI互动，普通聊天无需反复声明。该方案用于提高角色表现的一致性，不能保证精确复刻人物的“思维方式”。

验证要同时检查文字和表情：用夸赞、挫败、指出不足、告别等场景观察是否既承接具体内容又体现性格；连续切换话题、加入“别生气”“不要哭”等否定表达，检查本轮回复与情绪标签是否相符，并确认上一轮表情没有被机械沿用。再询问角色事实、未知剧情与AI身份，检查事实边界。单元测试验证接口、流和白名单，不能证明角色还原度；真实模型表现需通过多轮场景抽查持续校准，不以单次满意回复作为稳定效果的保证。

## 用量与隐私

AI 模式会把本条输入和近期 AI 对话通过 Vercel 发送至 DeepSeek。页面在输入区说明该行为。本地模式不上传聊天，两个模式的上下文不混传。本站不将聊天写入数据库、localStorage 或应用日志；服务提供商仍按其政策处理请求。

API 按调用计费。服务端限制输入条数与长度、输出 token、超时及并发，并提供**单实例、尽力而为**的 IP / 总请求频率限制。Vercel 多实例与冷启动会重置这些计数，不能将它当作全局额度或严格费用上限。同源校验也不能阻止脚本模拟请求。

公开启用前，建议设置 `CHAT_ACCESS_CODE`，并按项目套餐在 Vercel Firewall 针对 `/api/chat` 的 POST 请求配置持久限流，结合 DeepSeek 控制台的用量管理。不要仅依赖浏览器禁用按钮。删除服务端密钥并重新部署可关闭 AI，本地互动保持可用。

## 验证

运行 `node scripts/check-site.cjs`、`node scripts/test-dialogue.cjs`、`node scripts/test-chat-api.cjs` 与 `node scripts/test-chat-client.cjs`。AI 单元测试使用模拟上游，不联网、不消耗付费额度；并检查碎片流、异常输入、限流和服务错误。

上线后打开 `/api/chat`，只应看到 `enabled` 与 `accessCodeRequired` 等服务状态，不应出现密钥。该状态只说明配置存在，不代表密钥有效或余额充足。发送一条简短消息确认真实联通，再检查承接话题、表情动作、停止及清空功能。未做真实请求前不得宣称付费 API 已实测成功。

## 官方文档

- [DeepSeek API](https://api-docs.deepseek.com/)
- [DeepSeek 对话补全与流式参数](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel 函数取消支持](https://vercel.com/docs/functions/functions-api-reference)
- [Vercel 环境变量及重新部署](https://vercel.com/docs/environment-variables/managing-environment-variables)
