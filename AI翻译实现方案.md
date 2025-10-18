我已查阅 WhisperLiveKit（WLK）项目，以下是其功能与用法要点，并结合你当前的实时字幕与翻译需求给出“最快捷集成方案”（已纠正此前文档中的参数与路径表述）。

WLK 要点与正确参数说明

- 实时、本地语音转文本，支持多用户并发，内置 VAD（语音活动检测），并基于同时语音研究实现智能缓冲与增量处理，提升实时性与准确性。
- 提供现成的后端 FastAPI WebSocket 服务与前端模板，可直接启动并在浏览器访问。
- 模型参数的正确用法：
  - SimulStreaming Whisper 权重使用 .pt 格式，可通过 --model 选择尺寸（如 base/small/medium），或通过 --model-path 显式指定本地 .pt 文件路径（--model-path 会覆盖 --model）。
  - Faster-Whisper（CT2）平铺模型目录用于后端的编码器部分（目录包含 model.bin/config.json/tokenizer.json 等）；该目录需在服务启动时按 WLK 的后端配置进行指定与使用（不与 .pt 路径混淆）。
  - 语言可固定或使用 auto；如仅需日语→中文翻译，建议固定 language=ja 以降低误识别为英文的概率。
  - 若启用内置翻译（NLLB），需安装相关依赖；但本方案保持外部翻译（DeepSeek），不启用 WLK 内置翻译。

“独立 WLK 服务 + 现有 Python 微服务做转发与 DeepSeek 翻译”（推荐）

目标与约束：保持你现有 WebSocket/字幕协议不变；ASR 完全由 WLK 完成；最终翻译仍由 DeepSeek 执行；尽量减少代码改动，优先通过进程外服务与配置完成集成。

步骤
1) 安装并启动独立 WLK 服务（标准化到 9002 端口，固定日语、后端选 faster-whisper，优先使用本地模型）
   - 安装：pip install whisperlivekit
   - 启动建议（示例）：
     - 使用本地 SimulStreaming 权重：--model-path 指向 small.pt（例如 E:\...\ai-rt-service\small.pt）
     - 使用 Faster-Whisper 的本地 CT2 平铺目录（包含 model.bin/config.json/tokenizer.json）作为后端编码器模型源
     - 统一缓存：可设置 HF_HOME/HF_CACHE_DIR 指向项目内 .hf 目录，避免重复下载
   - 端点：统一使用 ws://127.0.0.1:9002/stream 作为对接路径

2) 在你的 Python 微服务中仅做“WS 转发与翻译”
   - 保持现有前端→微服务 WebSocket 协议与路径 /stream 不变
   - 收到前端音频分片（二进制）后，逐批转发到 WLK 的 /stream；并监听 WLK 的部分/最终结果消息
   - 在“最终结果”事件触发时调用 DeepSeek 翻译（已有 DeepSeek 环境变量与密钥读取机制），将日语转中文并按你现有消息格式回推给前端

3) 参数与运行建议
   - 模型：small（优先实时性，后续视性能可切换 medium）
   - 语言固定为 ja；后端选 faster-whisper；保持 VAD 开启以降低空段开销
   - 缓存与路径统一，避免重复下载：将 Hugging Face 缓存（HF_HOME/HF_CACHE_DIR）与本地模型目录统一在项目内，清晰管理

4) 前端无需大改（可选优化）
   - 延续当前前端发送音频的方式；如需更稳的实时性与缓冲平衡，可将 MediaRecorder 的 timeslice 从 1000ms 调整为约 1500ms（工程经验，非 WLK 文档硬性要求）

优势
- 极少代码改动：你的服务不需要直接初始化 WLK 引擎，仅做协议转发与翻译
- 部署更稳：WLK 服务独立运行，模型下载/目录问题与你的微服务隔离，适配更清晰
- 需求吻合：ASR 用 WLK 的实时缓冲与 VAD，翻译仍用 DeepSeek，满足“高灵活度 + faster-whisper + VAD + DeepSeek”
