import os
import asyncio
import json
import time
from typing import Dict, Any
from pathlib import Path

import websockets
from websockets.server import WebSocketServerProtocol

# 可选：集成 FasterWhisper 与 DeepSeek
# from faster_whisper import WhisperModel
# import httpx

HOST = os.getenv('PY_AI_HOST', '127.0.0.1')
PORT = int(os.getenv('PY_AI_PORT', '9001'))
WS_PATH = os.getenv('PY_AI_WS_PATH', '/stream')

# 从 local-deploy/.secrets 读取本地 DeepSeek 测试密钥（若未通过环境变量提供）
def get_env_or_secret(var_name: str, secret_filename: str, default: str = '') -> str:
    val = os.getenv(var_name, '').strip()
    if val:
        return val
    try:
        # 计算项目根目录（当前文件位于 ai-rt-service/）
        root = Path(__file__).resolve().parents[1]
        secrets_dir = root / 'local-deploy' / '.secrets'
        secret_path = secrets_dir / secret_filename
        if secret_path.exists():
            content = secret_path.read_text(encoding='utf-8', errors='ignore').strip()
            if content:
                # 同步到环境变量（便于后续库读取）
                os.environ[var_name] = content
                return content
    except Exception:
        pass
    return default

# DeepSeek 配置（优先环境变量，其次读取本地密钥文件）
DEEPSEEK_API_KEY = get_env_or_secret('DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY.txt', '')
DEEPSEEK_ENDPOINT = get_env_or_secret('DEEPSEEK_ENDPOINT', 'DEEPSEEK_ENDPOINT.txt', '')
DEEPSEEK_MODEL = get_env_or_secret('DEEPSEEK_MODEL', 'DEEPSEEK_MODEL.txt', '')

# FasterWhisper 配置
auto_device = os.getenv('FASTER_WHISPER_DEVICE', 'auto')
model_size = os.getenv('FASTER_WHISPER_MODEL_SIZE', 'small')
compute_type = os.getenv('FASTER_WHISPER_COMPUTE_TYPE', 'int8_float16')

# 备注：完整实现需要解码前端传来的 WebM/Opus 分片为统一的 PCM（单声道、16kHz），
# 然后使用 FasterWhisper 做增量识别，并将识别文本交给 DeepSeek 做断句/润色/翻译。
# 由于流式解码与增量 ASR 集成较复杂，这里提供一个可运行的占位服务，
# 用于验证前端/后端的 WebSocket 管道与 UI 流程。

class SessionState:
    def __init__(self) -> None:
        self.video_url: str = ''
        self.is_hls: bool = False
        self.target_lang: str = 'zh'
        self.preferred_src_lang: str = 'auto'
        self.last_ts: float = time.monotonic()

    def to_dict(self) -> Dict[str, Any]:
        return {
            'videoUrl': self.video_url,
            'isHLS': self.is_hls,
            'targetLang': self.target_lang,
            'preferredSrcLang': self.preferred_src_lang,
        }

async def handler(ws: WebSocketServerProtocol, path: str):
    # 仅处理指定路径
    if path != WS_PATH:
        await ws.close(code=4000, reason='Invalid path')
        return

    session = SessionState()
    first_chunk_logged = False
    # 首次 ready 信号，前端据此展示“已就绪”提示
    try:
        await ws.send(json.dumps({ 'type': 'ready' }))
    except Exception:
        pass

    try:
        async for message in ws:
            # 文本消息：协议控制/会话初始化
            if isinstance(message, str):
                try:
                    data = json.loads(message)
                except Exception:
                    continue
                t = (time.monotonic() - session.last_ts)
                session.last_ts = time.monotonic()

                if data.get('type') == 'hello':
                    session.video_url = str(data.get('videoUrl', '') or '')
                    session.is_hls = bool(data.get('isHLS', False))
                    session.target_lang = str(data.get('TargetLang', data.get('targetLang', 'zh')))
                    session.preferred_src_lang = str(data.get('preferredSrcLang', 'auto'))
                    try:
                        print(f"[PY] hello: isHLS={session.is_hls} target={session.target_lang} src={session.preferred_src_lang} video={session.video_url}")
                    except Exception:
                        pass
                    # 在完整实现中，此处可初始化 FasterWhisper 模型与 DeepSeek 客户端
                    continue
                elif data.get('type') == 'close':
                    try:
                        await ws.close()
                    except Exception:
                        pass
                    continue
                # 未知文本消息，忽略
                continue

            # 二进制消息：前端的音频分片（WebM/Opus 或其他）
            if isinstance(message, (bytes, bytearray)):
                if not first_chunk_logged:
                    try:
                        print(f"[PY] first audio chunk received, len={len(message)}")
                    except Exception:
                        pass
                    first_chunk_logged = True
                # 占位：不做实际 ASR，直接回推提示文本（不携带时间戳，前端使用当前播放时间）
                resp = {
                    'type': 'partial',
                    'text_src': '…',
                    'text_opt': '…',
                    'text_trans': 'Python服务已接收音频分片，等待ASR/翻译实现'
                }
                try:
                    await ws.send(json.dumps(resp))
                except Exception:
                    pass
                continue
    except websockets.ConnectionClosedOK:
        pass
    except websockets.ConnectionClosedError:
        pass
    except Exception:
        try:
            await ws.send(json.dumps({ 'type': 'error', 'code': 'PY_EXCEPTION', 'message': '服务内部错误' }))
        except Exception:
            pass
        try:
            await ws.close(code=1011, reason='Internal error')
        except Exception:
            pass

async def main():
    print(f"Python AI RT 服务启动: ws://{HOST}:{PORT}{WS_PATH}")
    async with websockets.serve(handler, HOST, PORT, max_size=16*1024*1024):
        await asyncio.Future()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass