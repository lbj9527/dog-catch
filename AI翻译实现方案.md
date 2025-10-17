下面给出“FasterWhisper 语音转文字 + DeepSeek 断句/润色/翻译”的完整实现方案与部署方案，覆盖架构设计、前后端改造点、数据协议、密钥配置、安全与运维，以及从开发到生产的落地步骤。所有密钥将通过环境变量（或部署脚本）配置，部署时由你填写，不会暴露到前端代码或仓库。

一、总体架构与数据流

前端（浏览器）：
在播放器中新增“AI 实时翻译”选项，仅对 m3u8（HLS）源启用。
基于 video 元素进行音频采集（优先 MediaRecorder + captureStream），按固定时长切片（如 1s），通过 WebSocket 推送到后端。
接收后端返回的实时字幕片段（包含时间戳和文本），写入一个专用 TextTrack，动态 addCue。
切换到 AI 模式后，等待“就绪”信号或首个稳定字幕，再弹出提示并恢复播放位置。
后端 Node 网关：
提供 WebSocket 服务 /ws/ai-translate，校验请求（是否 m3u8、是否允许、是否登录等），按连接维护会话状态。
将音频分片转发到 Python ASR/翻译服务（本地微服务），聚合返回的字幕片段并回推给前端。
承载密钥与访问控制，屏蔽前端对 DeepSeek 的直接调用。
Python 实时转写服务：
使用 FasterWhisper 进行增量 ASR（可启用语言检测、带时间戳），输出短句的 start/end。
将 ASR 文本送给 DeepSeek（LLM）进行断句/润色/翻译，合成最终字幕文本（源语言断句优化 + 目标语言翻译）。
流式返回部分结果（partial）与稳定结果（final）给后端网关。
DeepSeek（云端 LLM 服务）：
接收 ASR 原文和上下文（若需要），输出优化后的字幕文本（含断句、标点、必要时保持人名/术语），以及翻译结果（例如中文）。
使用可配置的模型与 endpoint，后端通过密钥鉴权。
二、前端实现改造点

文件改动位置：
在 player.js 中：
增加字幕下拉选项“AI 实时翻译”（常驻条目），选择后进入 AI_RT 模式。
仅在当前视频 URL 是 m3u8（含 #EXTM3U 或扩展名 .m3u8）时启用该模式，否则弹出不可用提示。
创建专用的 TextTrack（kind='subtitles', label='AI 实时翻译'），动态 addCue，和现有字幕轨道并存。
采集音频：优先使用 this.player.video.captureStream() + MediaRecorder（编码 opus，容器 webm/ogg），每 1s 收集 Blob，经 ArrayBuffer 转 Uint8Array 后发给后端。
WS 连接管理：建立 /ws/ai-translate 连接；发送 hello/metadata（视频 URL、播放时间、语言偏好）；持续发送音频分片；接收后端推送的字幕片段。
缓冲策略：发送侧（最多 4–6 秒）与接收侧（2–3 秒字幕队列），如网络拥塞，按“实时性优先”丢弃最旧发送音频分片；partial 先显示、final 替换或仅显示 final。
切换提示：模式切换后先缓冲，收到 ready 或首个稳定字幕后，右下角显示“AI 实时翻译已就绪”，恢复播放。
交互限制：当只有 AI 实时翻译可用时，禁用点赞与观看数；保持与“无字幕”一致的交互逻辑。
换行规范：对后端返回的字幕文本统一替换“\N / \n → 真实换行”，与已有逻辑保持一致，可复用 convertSRTtoVTT 中的处理思路。
在 index.html 已引入 hls.js 与 DPlayer，不需变更。
兼容回退：
若浏览器不支持 captureStream 或 MediaRecorder，使用 WebAudio API + AudioWorklet 拉取 PCM，再发送。
WS 断开时提示并自动重连；失败则回退普通字幕模式。
三、后端 Node 网关实现

文件位置：server.js
新增功能：
增加 WebSocket 路由 /ws/ai-translate。
校验请求（来源、m3u8 类型、鉴权标识如 JWT），初始化会话状态（语言偏好、目标翻译语言、上下文缓存）。
接收前端音频分片（Uint8Array），封装为带时间戳的帧队列，转发给 Python 服务（本机 localhost:PORT）。
接收 Python 服务的 partial/final 字幕片段，前端友好格式化后推送给客户端。
速率限制与并发控制（单 IP/单用户连接数等），避免滥用。
配置：
环境变量读取（在 Node 端不直接持有 DeepSeek 密钥，密钥仅在 Python 服务使用）：
AI_TRANSLATE_ENABLED=true/false
PY_AI_SERVICE_URL=http://127.0.0.1:9001 或 ws://127.0.0.1:9001/stream
WS_MAX_CONNECTIONS=…
AUTH/JWT 验证相关（已存在的 JWT 体系可沿用）
四、Python 实时转写服务实现（FasterWhisper + DeepSeek）

服务结构（建议新建一个独立 Python 微服务）：
路由：/stream（WebSocket）或 /transcribe（HTTP/长连接），推荐 WS。
输入：音频分片（opus webm/ogg 或 PCM），附带元数据（采样率、声道、时间戳、序列号、目标语言）。
处理：
解码音频分片为统一的 PCM（单声道，16kHz）。
调用 FasterWhisper 增量识别（可以按固定窗口或 VAD 边界），返回每段文本的起止时间与语言信息。
将识别文本按上下文合并为合理句子（可基于时间/停顿），并调用 DeepSeek：
子任务 A：断句与标点修正（保持原语言自然流畅）
子任务 B：翻译到目标语言（如中文），保留术语、人名、专有名词尽量准确（可在 prompt 中强调）。
输出 JSON 片段：{ type: "partial"|"final", start, end, text_src, text_opt, text_trans }。
DeepSeek 接口：
使用环境变量配置：
DEEPSEEK_API_KEY=（部署时填写）
DEEPSEEK_ENDPOINT=https://api.deepseek.xxx（部署时填写）
DEEPSEEK_MODEL=（如 deepseek-chat 或你指定的具体模型，部署时填写）
调用方式：HTTP/REST（可选流式），后端在 Python 端承载密钥并统一调用，不暴露给前端。
Prompt 设计（示例思路）：
输入：ASR 原文（含上下文若需要），语言标识，时间信息。
约束：输出 JSON 格式，字段含 optimized_src（断句+标点后的原文）、translation_zh（翻译）、notes（可选，术语保留/别名说明）。
风格：保证简洁准确，不添加额外解释；保留可能的专有名词；数字与单位准确。
配置：
FASTER_WHISPER_MODEL_SIZE=（如 medium、small）
FASTER_WHISPER_DEVICE=auto/cpu/cuda
FASTER_WHISPER_COMPUTE_TYPE=int8_float16 等（视硬件）
MAX_LATENCY_MS、CHUNK_MS（如 1000ms）、VAD/合并阈值等
安全与限流：
每连接的速率与并发控制；对异常流量关闭会话。
超时与错误处理：DeepSeek 异常（重试/降级仅返回 ASR 文本）；ASR 失败（重试 brief）。
五、前后端通信协议（建议）

前端 → 后端（WS）：
hello：{ type:"hello", videoUrl, isHLS:true, targetLang:"zh", preferredSrcLang:"auto" }
audio：{ type:"audio", seq, tStart, tEnd, mime:"audio/webm; codecs=opus", payload:ArrayBuffer }
control：{ type:"seek", currentTime }、{ type:"stop" }、{ type:"close" }
后端 → 前端（WS）：
ready：{ type:"ready" }（收到后显示“AI 实时翻译已就绪”）
partial：{ type:"partial", start, end, text_src, text_opt, text_trans }
final：{ type:"final", start, end, text_src, text_opt, text_trans }
error：{ type:"error", code, message }
六、密钥与配置管理

前端：不持有任何密钥。仅通过配置开关决定 UI 是否展示“AI 实时翻译”。
后端 Node：
.env 或部署脚本注入：
AI*TRANSLATE_ENABLED=true/false
PY_AI_SERVICE_URL=…
JWT_SECRET=…（已存在）
Python 服务：
环境变量（部署时填写，不写入仓库）：
DEEPSEEK_API_KEY=…
DEEPSEEK_ENDPOINT=…
DEEPSEEK_MODEL=…
FASTER_WHISPER*\*（模型大小/设备/推理精度等）
部署脚本：
复用已有 set-env.ps1 与 set-env.sh 思路，在其中新增以上环境变量注入。
不将密钥写入仓库；生产环境通过 CI/CD 注入或服务器上以系统环境变量方式提供。
七、部署方案与步骤

开发环境（Windows，本地）：

1.  安装依赖：
    前端：在 vite.config.js 已存在；运行前端 dev（vite）。确保允许跨域访问后端 WS。
    后端 Node：在 package.json 中添加/使用启动脚本，运行 server.js。
    Python 服务：创建虚拟环境，安装 faster-whisper、ffmpeg/pyav（音频解码）、websockets/fastapi（WS/HTTP），以及 requests/httpx（DeepSeek 调用）。
2.  配置环境变量（本地 .env 或 PowerShell 环境）：
    DEEPSEEK_API_KEY/ENDPOINT/MODEL（Python）
    PY_AI_SERVICE_URL（Node）
    AI_TRANSLATE_ENABLED=true（Node）
3.  启动顺序：先 Python 服务 → 后端 Node → 前端 dev。
4.  本地测试：使用任意 m3u8 URL，在播放器选择“AI 实时翻译”，观察右下角“已就绪”提示与字幕轨道更新。
    生产环境（Linux 推荐）：

5.  进程管理：PM2 运行 Node；Python 使用 systemd 或 PM2（ecosystem 配置中增加 python 进程命令）。
    参考 pm2-ecosystem.config.js 扩展多个 app 定义（backend、python-rt-asr）。
6.  反向代理（Nginx）：
    HTTP 代理到 Node（REST）。
    WS 代理 /ws/ai-translate 到 Node（确保 upgrade/connection 头正确）。
    Node 与 Python 服务用内网地址通信。
    参考 nginx-sites.conf 增加 WS 路由。
7.  环境变量注入：在服务器上用 set-env.sh 或系统级配置注入 DEEPSEEK_API_KEY 等密钥；不写入仓库。
8.  监控与日志：Node 与 Python 分别输出结构化日志；Nginx access/error 日志保留；必要时加采样与隐私遮蔽。
9.  性能：
    Python 侧可启用 CUDA（FASTER_WHISPER_DEVICE=cuda）以降低延迟。
    前端采集单声道/16kHz，降低带宽与负载。
    深度优化后可引入缓存（同句多次重复不再调用 DeepSeek），或批处理短文本以减少 API 费用。
    八、性能与体验优化建议

延迟目标：
端到端首帧 < 1.5–2s（采集 + 识别 + LLM 优化 + 回推）。
持续流转 < 1s。
采样与编码：
采集时降为单声道 16kHz；MediaRecorder 使用 opus。
文本质量：
DeepSeek prompt 加强术语保留、数字单位准确；对脏话/敏感词做规范化处理（可选）。
缓冲与回退：
WS 重连策略 + 指数退避。
LLM 调用失败时仅显示 ASR 文本；成功后替换为优化/翻译版本。
Seek/跳转：
清空队列并通知后端新的 currentTime；后端基于新的时间点继续识别翻译。
九、安全与合规

鉴权：
复用你已有的 JWT（见 local-deploy/.secrets/JWT_SECRET.txt），Node 端校验后才允许建立 WS 会话。
限流：
单 IP/账号的并发会话与速率限制，避免占用过多后端资源。
隐私：
不在日志中输出用户音频内容/字幕文本；仅记录长度、时间戳、错误码。
CORS：
你已设置 video 的 crossorigin='anonymous'（见 player.js），确保视频源服务器正确返回 Access-Control-Allow-Origin。
十、迭代计划（落地分阶段）

MVP（1–2 天）：
前端：新增菜单项 + m3u8 校验 + captureStream + MediaRecorder + WS 发送；AI 轨道 addCue；“已就绪”提示。
后端 Node：WS 网关 + 与 Python 服务的桥接；基本错误处理。
Python：FasterWhisper 本地识别；DeepSeek 非流式调用，每段返回 final 结果；基础 JSON 协议。
V1（优化版）：
Python：流式识别 + 流式 DeepSeek；partial/final 双态；语言自动检测与推断。
前端：接收 partial 先显示、final 替换；队列去抖；断线重连与提示。
V2（增强）：
术语表与人名词典；翻译风格控制（更口语/更正式）；费用控制（缓存/批处理）。
运营侧面板统计 AI 使用时长、成功率、延迟分布。
十一、下一步我可以为你做什么

我可以直接在以下文件中完成 MVP 版的前后端对接代码：
前端：在 player.js 增加“AI 实时翻译”选项、模式切换、音频采集与 WS 管理、AI 字幕轨道渲染；遵循你现有的代码风格与事件流。
后端：在 server.js 增加 /ws/ai-translate 网关（包含并发/限流/错误处理）。
Python：新增一个微服务脚手架（FasterWhisper + DeepSeek），并把 DEEPSEEK_API_KEY/ENDPOINT/MODEL 作为环境变量读取。
你只需在部署时设置环境变量（我会提供示例变量名与启动命令），无需在仓库中保存任何密钥。
