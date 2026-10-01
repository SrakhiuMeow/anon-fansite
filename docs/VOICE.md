# 爱音聊天语音

网站采用 Fish Audio 托管 TTS，默认选用社区用户“高尾祥子”发布的千早爱音音色。DeepSeek 负责生成回复，语音接口朗读完整的回复正文，不把网页来源、情绪控制标签或按钮文字当成台词。这是 AI 合成的同人音色，不是官方录音或声优本人发言。

## 在 Vercel 启用

1. 前往 [Fish Audio API Keys](https://fish.audio/app/api-keys)，注册或登录后创建自己的 API Key。
2. 打开 Vercel 中的 `anon-fansite` 项目，进入 **Settings → Environment Variables**。
3. 新增 `FISH_AUDIO_API_KEY`，值为该密钥，勾选 **Production** 并保存。如需预览部署，再添加 Preview。
4. 重新部署项目，或在保存变量后由新的 Git 推送触发部署。刷新网站并解锁 AI 聊天。
5. 发一条简短消息，等待完整回复，点击气泡下方“播放语音”。手机端的“自动朗读”在聊天齿轮设置中，默认关闭。

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `FISH_AUDIO_API_KEY` | 是 | 只在 `/api/tts` 服务端使用，不发送给浏览器，不提交 Git |
| `FISH_AUDIO_VOICE_ID` | 否 | 默认 `c5c17c9709384ba9a4b294662a2af0b1`；只在需要更换可用爱音音色时填写32位音色ID |
| `CHAT_ACCESS_CODE` | 否 | 与现有聊天共用密码设置，不新增另一套解锁密码 |

不要把密钥填入聊天、前端代码或以 `NEXT_PUBLIC_` / `VITE_` 开头的变量。默认爱音音色来自[公开音色页](https://fish.audio/zh-CN/m/c5c17c9709384ba9a4b294662a2af0b1/)，可在该页试听。更换ID前需确认是预期音色；参考音色是否仍公开可用以服务商实际返回为准。

## 播放行为

- 只有成功完成的 AI 回复显示播放按钮，本地预设、失败或取消的半段回复不合成。
- 默认手动点击播放；开启自动朗读后，后续完整回复在文字显示结束后开始生成并播放。流式文字和原 Live2D 表情动作机制保持原样，此版不增加口型同步。
- 同时只播放一条。发送新消息、停止回复、锁定、切换模式、清空、页面转到后台都会停止当前播放或生成。
- 首次播放受浏览器的音频策略影响；自动播放被拒绝时显示“语音已就绪，请点击重播”，再次点击会播放已生成音频。
- 重播优先使用当前页缓存，最多保留5条、合计12MiB；单条最多4MiB。清空、锁定、模式切换及离开页面会释放缓存。声音和自动朗读选择不存入 localStorage、数据库或聊天历史。
- 未配置服务时显示待配置，语音失败只影响播放，不修改已有文字、不改用系统女声冒充爱音。

## 服务、费用和数据

固定请求 `https://api.fish.audio/v1/tts`，明确使用 `model: s2.1-pro-free`，不会漏填模型字段，也不自动切换付费模型。服务商公告的免费开发者窗口当前至 **2026年11月30日**，受公平使用规则及可用性限制，无延迟保证；后续政策可能变化，使用前查看[免费模型说明](https://fish.audio/es/blog/s2-1-pro-free-api/?articleLocale=en)和[价格与限制](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits)。

点击播放或开启自动朗读后，仅将待朗读的这一条 AI 回复经本站服务端发送给 Fish Audio，不发送用户的聊天输入、完整对话、聊天密码或网页来源。本站不记录合成文本和音频日志；服务商可能按其免费层与隐私政策保留请求或用于改进模型。聊天设置中说明语音数据的去向。

`/api/tts` POST 使用与聊天相同的密码认证与同源检查。密钥、端点和音色由服务端决定，客户端不能指定外部请求地址或付费模型；二进制响应有类型、大小、超时和并发限制，禁止缓存到公共CDN。实例内限流是尽力而为的防误用措施，不是跨实例总额度保证。

## 验证

运行 `node scripts/test-tts-api.cjs`、`node scripts/test-voice-client.cjs`、`node scripts/test-chat-client.cjs` 和 `node scripts/check-site.cjs`。这些检查使用模拟服务，不会消耗真实语音额度。部署后 `GET /api/tts` 的 `enabled` 只说明配置存在，不能代替真实合成及播放验证。

## 接口依据

- [Fish Audio TTS API](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)
- [公开音色 ID 的使用方式](https://docs.fish.audio/developer-guide/getting-started/quickstart)
- [千早爱音社区音色与作者](https://fish.audio/zh-CN/m/c5c17c9709384ba9a4b294662a2af0b1/)
