# AI 实时翻译实现方案（FasterWhisper + DeepSeek）

本文提供从架构到部署的完整方案：覆盖前端采集与渲染、后端网关转发、Python 实时转写与 LLM 优化、通信协议、密钥与配置管理、部署与运维，以及分阶段落地。所有密钥通过环境变量（或部署脚本）配置，部署时填写，不进入前端代码或仓库。

## 目录
- 总体架构与数据流
- 前端实现改造点
- 后端 Node 网关实现
- Python 实时转写服务实现
- 前后端通信协议
- 密钥与配置管理
- 部署方案与步骤
- 性能与体验优化建议
- 安全与合规
- 迭代计划（落地分阶段）
- 下一步实施建议

## 总体架构与数据流
- 前端（浏览器）
  - 播放器新增“AI 实时翻译”选项，仅对 `m3u8`（HLS）源启用。
  - 基于 `video.captureStream()` + `MediaRecorder` 采集音频，按 1s 切片，经 `WebSocket` 推送到后端。
  - 接收后端返回的字幕片段（含时间戳与文本），写入专用 `TextTrack`，动态 `addCue`。
  - 切换到 AI 模式后，等待 `ready` 或首个稳定字幕，弹出“已就绪”提示并恢复播放位置。
- 后端 Node 网关
  - 提供 `WS /ws/ai-translate`；校验来源、是否 `m3u8`、是否允许与登录等。
  - 将音频分片转发到 Python 微服务；聚合返回的字幕片段并回推前端。
  - 承载访问控制与速率限制；前端不直接持有或调用 DeepSeek 密钥。
- Python 实时转写服务
  - 使用 FasterWhisper 增量 ASR（可启用语言检测、时间戳），输出段落 `start/end`。
  - 将 ASR 文本送 DeepSeek（LLM）进行断句/润色/翻译，合成最终字幕文本。
  - 流式返回 `partial` 与 `final` 两类结果给 Node 网关。
- DeepSeek（云端 LLM）
  - 接收 ASR 原文与必要上下文，返回优化文本（断句、标点、术语保留）与翻译结果。
  - 通过后端配置的 `endpoint/model/apiKey` 调用，密钥仅在 Python 持有。

## 前端实现改造点（player.js）
- 菜单与模式
  - 在字幕下拉中新增常驻条目“AI 实时翻译”；选择进入 `AI_RT` 模式。
  - 仅当视频 URL 为 `m3u8`（含 `#EXTM3U` 或扩展名 `.m3u8`）时启用，否则提示不可用。
- 字幕轨与渲染
  - 创建专用 `TextTrack`（`kind='subtitles', label='AI 实时翻译'`），与现有轨并存；通过 `addCue` 动态写入。
  - 对返回文本统一换行：将 `\N`/`\n` 替换为真实换行（可复用 `convertSRTtoVTT` 的思路）。
- 音频采集与发送
  - 优先 `captureStream()` + `MediaRecorder`（编码 `opus`，容器 `webm/ogg`）；每 1s 收集 Blob → `ArrayBuffer` → `Uint8Array`。
  - 建立 `WS /ws/ai-translate`；发送 `hello/metadata`（`videoUrl/currentTime/lang pref`）；持续发送音频分片；接收字幕片段。
- 缓冲与提示
  - 发送侧缓冲最多 4–6s；接收侧字幕队列 2–3s；拥塞时“实时优先”丢弃最旧发送分片。
  - `partial` 先显示、`final` 替换；收到 `ready` 或首个稳定字幕时右下角显示“AI 实时翻译已就绪”。
- 交互限制与回退
  - 当只有 AI 字幕可用时，禁用点赞与观看数；保持与“无字幕”一致的交互逻辑。
  - 兼容回退：若浏览器不支持 `captureStream`/`MediaRecorder`，用 `WebAudio API + AudioWorklet` 拉取 PCM 再发送。
  - WS 断开自动重连；失败则回退普通字幕模式。

## 后端 Node 网关实现（server.js）
- 新增 `WS /ws/ai-translate` 路由。
- 校验请求：来源、视频类型（`m3u8`）、鉴权标识（如 `JWT`）。初始化会话状态（语言偏好、目标翻译语言、上下文缓存）。
- 接收前端音频分片（`Uint8Array`），封装为带时间戳的帧队列，转发至 Python 服务（如 `http://127.0.0.1:9001` 或 `ws://127.0.0.1:9001/stream`）。
- 接收 Python 的 `partial/final` 字幕片段，格式化为前端友好结构后推送客户端。
- 速率限制与并发控制（单 IP/用户连接数等），防滥用。
- 配置（读取环境变量）：
  - `AI_TRANSLATE_ENABLED=true/false`
  - `PY_AI_SERVICE_URL=http://127.0.0.1:9001` 或 `ws://127.0.0.1:9001/stream`
  - `WS_MAX_CONNECTIONS=...`（可选）
  - `JWT_SECRET=...`（沿用现有体系）

## Python 实时转写服务（FasterWhisper + DeepSeek）
- 路由：`/stream`（WS）或 `/transcribe`（HTTP/长连接），推荐 WS。
- 输入：音频分片（`opus webm/ogg` 或 `PCM`），附元数据（采样率、声道、时间戳、序列号、目标语言）。
- 处理流程：
  - 统一解码到 `PCM`（单声道，16kHz）。
  - FasterWhisper 增量识别（固定窗口或 VAD 边界），返回文本段 `start/end/lang`。
  - 上下文合并为合理句子；调用 DeepSeek：
    - A：断句与标点修正（保持原语流畅）。
    - B：翻译到目标语言（如中文），术语/人名尽量保留（在 prompt 中强调）。
  - 输出 JSON 片段：`{ type:'partial'|'final', start, end, text_src, text_opt, text_trans }`。
- DeepSeek 接入：
  - 环境变量：`DEEPSEEK_API_KEY`、`DEEPSEEK_ENDPOINT`、`DEEPSEEK_MODEL`。
  - 调用方式：HTTP/REST（可选流式），密钥仅在 Python 持有，不暴露给前端。
- Prompt 设计（建议）：
  - 输入：ASR 原文 + 可选上下文 + 语言标识 + 时间信息。
  - 约束：输出 JSON 字段 `optimized_src`（断句+标点）、`translation_zh`（翻译）、`notes`（术语说明，可选）。
  - 风格：简洁准确；数字单位准确；保留专有名词。
- 配置建议：
  - `FASTER_WHISPER_MODEL_SIZE=small|medium`
  - `FASTER_WHISPER_DEVICE=auto|cpu|cuda`
  - `FASTER_WHISPER_COMPUTE_TYPE=int8_float16`（视硬件）
  - `MAX_LATENCY_MS`、`CHUNK_MS`（如 1000ms）、`VAD`/合并阈值
- 安全与限流：每连接速率与并发控制；异常流量关闭会话；DeepSeek 异常降级仅返回 ASR 文本；ASR 失败重试 brief。

## 前后端通信协议（WS）
- 前端 → 后端：
  - `hello`: `{ type:"hello", videoUrl, isHLS:true, targetLang:"zh", preferredSrcLang:"auto" }`
  - `audio`: `{ type:"audio", seq, tStart, tEnd, mime:"audio/webm; codecs=opus", payload:ArrayBuffer }`
  - `control`: `{ type:"seek", currentTime }` / `{ type:"stop" }` / `{ type:"close" }`
- 后端 → 前端：
  - `ready`: `{ type:"ready" }`
  - `partial`: `{ type:"partial", start, end, text_src, text_opt, text_trans }`
  - `final`: `{ type:"final", start, end, text_src, text_opt, text_trans }`
  - `error`: `{ type:"error", code, message }`

## 密钥与配置管理
- 前端：不持任何密钥；仅通过配置开关决定 UI 是否展示“AI 实时翻译”。
- Node 后端（`.env` 或部署脚本注入）：`AI_TRANSLATE_ENABLED`、`PY_AI_SERVICE_URL`、`WS_MAX_CONNECTIONS`、`JWT_SECRET`。
- Python 服务（服务器环境变量，部署时填写，不入仓库）：`DEEPSEEK_API_KEY`、`DEEPSEEK_ENDPOINT`、`DEEPSEEK_MODEL`、`FASTER_WHISPER_*`。
- 部署脚本：复用 `set-env.ps1` 与 `set-env.sh` 的思路，新增上述变量注入；生产通过 CI/CD 或系统级环境变量提供；不将密钥写入仓库。

## 部署方案与步骤
- 开发环境（Windows，本地）
  1. 安装依赖：前端（Vite dev）/ 后端（Node，`server.js`）/ Python（`faster-whisper`、`pyav/ffmpeg`、`websockets/fastapi`、`requests/httpx`）。
  2. 配置环境变量：`DEEPSEEK_API_KEY/ENDPOINT/MODEL`（Python）、`PY_AI_SERVICE_URL`（Node）、`AI_TRANSLATE_ENABLED=true`（Node）。
  3. 启动顺序：先 Python 服务 → 再 Node → 最后前端 dev。
  4. 本地测试：用任意 `m3u8` URL，选择“AI 实时翻译”，观察“已就绪”提示与字幕轨更新。
- 生产环境（Linux 推荐）
  5. 进程管理：PM2 运行 Node；Python 用 `systemd` 或 PM2（在 `pm2-ecosystem.config.js` 扩展多个 app）。
  6. 反向代理（Nginx）：HTTP 代理到 Node；WS 代理 `/ws/ai-translate`（确保 `upgrade/connection` 头）；Node 与 Python 用内网地址通信。
  7. 环境注入：服务器 `set-env.sh` 或系统级变量注入 `DEEPSEEK_*` 等密钥；不写入仓库。
  8. 监控与日志：Node 与 Python 输出结构化日志；保留 Nginx access/error；必要时加采样与隐私遮蔽。
  9. 性能：Python 可启用 CUDA 降延迟；前端采集单声道/16kHz 降带宽；可引入缓存/批处理控制 DeepSeek 成本。

## 性能与体验优化建议
- 延迟目标：首帧 < 1.5–2s；持续流转 < 1s。
- 采样与编码：单声道 16kHz；`MediaRecorder` 使用 `opus`。
- 文本质量：Prompt 强化术语保留、数字单位准确；可选敏感词规范化。
- 缓冲与回退：WS 重连策略 + 指数退避；LLM 失败时仅显示 ASR 文本，成功后替换优化/翻译版。
- Seek/跳转：清空队列并通知后端新的 `currentTime`；后端从新时间继续识别翻译。

## 安全与合规
- 鉴权：复用现有 `JWT`（见 `local-deploy/.secrets/JWT_SECRET.txt`），Node 校验后允许 WS 会话。
- 限流：单 IP/账号并发与速率限制，避免占用过多资源。
- 隐私：日志不输出用户音频内容/字幕文本，仅记录长度、时间戳、错误码。
- CORS：视频元素 `crossorigin='anonymous'`（见 `player.js`），确保视频源服务器返回 `Access-Control-Allow-Origin`。

## 迭代计划（落地分阶段）
- MVP（1–2 天）
  - 前端：菜单项 + `m3u8` 校验 + `captureStream` + `MediaRecorder` + WS 发送；AI 轨 `addCue`；“已就绪”提示。
  - Node：WS 网关 + Python 桥接；基本错误处理。
  - Python：FasterWhisper 本地识别；DeepSeek 非流式调用，每段返回 `final`；基础 JSON 协议。
- V1（优化版）
  - Python：流式识别 + 流式 DeepSeek；`partial/final` 双态；语言自动检测与推断。
  - 前端：接收 `partial` 先显示、`final` 替换；队列去抖；断线重连与提示。
- V2（增强）
  - 术语表与人名词典；翻译风格控制（口语/正式）；费用控制（缓存/批处理）。
  - 运营面板统计 AI 使用时长、成功率、延迟分布。

## 下一步实施建议
- 我可以直接在以下文件中完成 MVP 版对接：
  - 前端：`player.js` 增加“AI 实时翻译”选项、模式切换、音频采集与 WS 管理、AI 字幕轨渲染；遵循现有代码风格与事件流。
  - 后端：`server.js` 增加 `/ws/ai-translate` 网关（包含并发/限流/错误处理）。
  - Python：新增微服务脚手架（FasterWhisper + DeepSeek），读取 `DEEPSEEK_*` 环境变量。
- 你只需在部署时设置环境变量（我将提供示例变量名与启动命令），无需在仓库保存任何密钥。

## MVP 实现现状与进度（2025-10-18）
- 已打通的链路与行为
  - 前端（`frontend/public/player.js`）
    - 下拉“选择字幕”新增“AI实时翻译”入口，仅对 `m3u8/HLS` 源启用；进入后建立 `WS /ws/ai-translate` 并发送 `hello`。
    - 使用 `captureStream()` + `MediaRecorder(opus)` 每 1s 采集音频分片发送；不支持时回退 `WebAudio API` 采集。
    - 创建专用 `TextTrack(label='AI实时翻译')` 并 `addCue` 动态渲染；文本做 `\\N/\\n` 换行规范化。
    - 修复：从“AI实时翻译”切回字幕文件时，停止 WS 和录音、禁用并清空 AI 轨 `cues`，只显示所选文件轨（占位字幕不再残留）。
    - 时间轴：Python 占位不再下发 `start/end`，前端使用 `video.currentTime` 作为 cue 起止（+2s）。
  - 后端（`backend/src/server.js`）
    - 新增 `WS /ws/ai-translate` 网关，校验 `isHLS`、初始 `hello` 参数，记录连接生命周期日志。
    - 与 Python 服务桥接（本地 dev 当前为 `ws://127.0.0.1:9002/stream`，通过 `PY_AI_SERVICE_URL` 配置），转发音频分片并回推 `ready/partial/final`。
    - 日志涵盖：Upgrade、Client hello、Bridge connected、PY->Client ready、Client audio chunk、PY->Client partial。
  - Python（`ai-rt-service/rt_asr_service.py`）
    - 占位实现：收到 `hello` 与首个音频分片写入日志，返回 `ready` 与流式 `partial` 文本（用于管道验证）。
    - 修正：去除占位 `partial` 的 `start/end` 字段，避免与视频时间轴错位导致字幕不可见；首块音频仅打印一次避免刷屏。
- 启停与验证
  - 本地脚本：`local-deploy/dev.ps1 start-all -Open` 启动前端/后端/AI服务；端口示例：后端 `8000`、前端 `5173`、管理端 `3001`、Python `9002`。
  - 前端验证：选择“AI实时翻译”后收到 `ready`，字幕即刻显示；切回字幕文件后 AI 占位字幕消失。
  - 观测建议：
    - 浏览器控制台：`Array.from(document.querySelector('video').textTracks).map(t=>({label:t.label,mode:t.mode,cues:t.cues?.length}))`，期望 AI 轨 `disabled`，文件轨 `showing`。
    - 后端日志：持续出现 `PY->Client partial` 与 `Client audio chunk`。
- 当前边界与限制
  - 文本为占位，不含真实 ASR/翻译；`partial/final` 的替换逻辑尚未实现实际质量提升。
  - 速率限制、鉴权、异常降级为基础版；断线重连与 seek/跳转的时间同步未完善。
  - 仅验证 HLS 流；对无音轨或浏览器禁麦场景做了错误提示但未深度处理。

## 后续优化项与计划
- 识别与翻译（V1）
  - 集成 FasterWhisper（增量/流式）与 VAD/窗口合并，输出稳定段的 `start/end/lang`。
  - 接入 DeepSeek：断句与标点优化 + 翻译；Prompt 强化术语/数字单位；支持流式返回。
  - `partial` 先显示、`final` 替换；前端维护队列去抖与重排、避免闪烁。
- 时间轴与同步
  - 从 Python 端提供可靠 `start/end`，前端对齐 `video.currentTime` 做微调/钳制；支持 seek 时清空队列并下发新 `currentTime`。
- 稳定性与回退
  - WS 自动重连（指数退避）；发送侧拥塞丢弃最旧分片；接收侧 2–3s 队列窗口。
  - DeepSeek 异常降级：仅显示 ASR 文本；恢复后替换优化/翻译版。
- 性能与成本
  - 采样统一单声道 16kHz；GPU/CUDA（可选）与 `compute_type=int8_float16`；缓存与批处理控制 LLM 成本。
- 安全与合规
  - 并发/速率限制与权限校验完善；日志结构化、隐私遮蔽；Nginx/PM2 监控接入。
- 配置与运维
  - 环境变量：`PY_AI_SERVICE_URL`、`AI_TRANSLATE_ENABLED`（Node）；`DEEPSEEK_*`、`FASTER_WHISPER_*`（Python）。
  - 统一部署脚本：本地/生产一套参数化启动；端口与健康检查；错误告警。

## 进度摘要（MVP）
- 已完成：前端 AI 模式、音频采集与 WS、AI 轨渲染与切换修复；后端 WS 网关与桥接、全链路日志；Python 占位服务与时间轴修正；本地启动与前端验证。
- 待完成（V1）：FasterWhisper + DeepSeek 集成、`partial/final` 机制、时间戳对齐与 seek 支持、重连与降级、速率/权限控制。
- 目标：首帧 < 2s、持续 < 1s 的体验；真实翻译与优化文本稳定显示。
