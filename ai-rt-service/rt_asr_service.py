import os
import asyncio
import json
import time
from typing import Dict, Any
from pathlib import Path

import websockets
from websockets.server import WebSocketServerProtocol
from websockets.client import WebSocketClientProtocol

# 可选：集成 FasterWhisper 与 DeepSeek
# from faster_whisper import WhisperModel
import httpx

HOST = os.getenv('PY_AI_HOST', '127.0.0.1')
PORT = int(os.getenv('PY_AI_PORT', '9001'))
WS_PATH = os.getenv('PY_AI_WS_PATH', '/stream')

# WLK 服务对接参数（由 dev.ps1 持久化注入）
WLK_HOST = os.getenv('WLK_HOST', '127.0.0.1')
WLK_PORT = int(os.getenv('WLK_PORT', '9002'))
WLK_WS_PATH = os.getenv('WLK_WS_PATH', '/asr')

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

class SessionState:
    def __init__(self) -> None:
        self.video_url: str = ''
        self.is_hls: bool = False
        self.target_lang: str = 'zh'
        self.preferred_src_lang: str = 'auto'
        self.last_ts: float = time.monotonic()
        # 追踪已发送的行，避免重复发送；以及最近的缓冲文本
        self.last_buffer: str = ''
        self.sent_line_keys: set[str] = set()

    def to_dict(self) -> Dict[str, Any]:
        return {
            'videoUrl': self.video_url,
            'isHLS': self.is_hls,
            'targetLang': self.target_lang,
            'preferredSrcLang': self.preferred_src_lang,
        }

async def translate_deepseek(text: str, target_lang: str = 'zh') -> str:
    """调用 DeepSeek 将识别文本翻译到目标语言。
    若配置缺失或调用失败，则回退为原文。
    """
    if not text:
        return ''
    if not (DEEPSEEK_API_KEY and DEEPSEEK_ENDPOINT and DEEPSEEK_MODEL):
        return text
    try:
        headers = {
            'Authorization': f'Bearer {DEEPSEEK_API_KEY}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
        # 构造一个兼容 chat-completions 的翻译提示
        payload = {
            'model': DEEPSEEK_MODEL,
            'temperature': 0.2,
            'messages': [
                {
                    'role': 'system',
                    'content': 'You are a professional translation engine. Translate the user text into the target language, keep names consistent, avoid adding explanations.'
                },
                {
                    'role': 'user',
                    'content': f'Target language: {target_lang}\nText: {text}'
                }
            ]
        }
        # 规范化 DeepSeek Endpoint，确保指向 /v1/chat/completions
        ep = str(DEEPSEEK_ENDPOINT).strip()
        ep = ep.rstrip('/')
        if not ep.endswith('/chat/completions'):
            if ep.endswith('/v1'):
                ep = ep + '/chat/completions'
            else:
                ep = ep + '/v1/chat/completions'
        try:
            print(f"[PY][DeepSeek] POST {ep} model={DEEPSEEK_MODEL} target={target_lang} len={len(text)}")
        except Exception:
            pass

        insecure = os.getenv('INSECURE', '')
        verify_flag = False if insecure else True
        try:
            print(f"[PY][DeepSeek] INSECURE={'1' if not verify_flag else '0'}")
        except Exception:
            pass

        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0), http2=False, verify=verify_flag, trust_env=False) as client:
            r = await client.post(ep, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
            # 兼容常见返回结构
            if isinstance(data, dict):
                if 'choices' in data and data['choices']:
                    msg = data['choices'][0].get('message') or {}
                    content = msg.get('content') or ''
                    return content.strip() or text
                # 其他结构，尝试直接读取
                if 'output_text' in data:
                    return str(data['output_text']).strip() or text
            return text
    except Exception as e:
        try:
            print(f"[PY][DeepSeek] translate failed: {e}")
        except Exception:
            pass
        return text

async def relay_wlk_to_client(wlk_ws: WebSocketClientProtocol, ws: WebSocketServerProtocol, session: SessionState):
    """读取 WLK 服务的识别输出并转发给前端。
    - partial：直接转发识别原文（来源于 buffer_transcription）
    - final：在原文基础上调用 DeepSeek 翻译并携带译文（来源于 lines）
    """
    try:
        async for msg in wlk_ws:
            if isinstance(msg, str):
                # WLK 端 JSON 消息
                try:
                    data = json.loads(msg)
                except Exception:
                    continue
                # 转发错误
                try:
                    if data.get('error'):
                        await ws.send(json.dumps({'type': 'error', 'code': 'WLK_ERROR', 'message': str(data.get('error'))}))
                except Exception:
                    pass

                # 处理 buffer_transcription -> partial
                try:
                    buf = str(data.get('buffer_transcription') or '').strip()
                except Exception:
                    buf = ''
                if buf:
                    if buf != session.last_buffer:
                        session.last_buffer = buf
                        resp_partial = {
                            'type': 'partial',
                            'text_src': buf,
                            'text_opt': buf,
                        }
                        try:
                            await ws.send(json.dumps(resp_partial, ensure_ascii=False))
                        except Exception:
                            pass

                # 处理 lines -> final（逐行发送）
                lines = data.get('lines') or []
                if isinstance(lines, list) and lines:
                    for line in lines:
                        if not isinstance(line, dict):
                            continue
                        text = str(line.get('text') or '').strip()
                        if not text:
                            continue
                        key = f"{text}|{line.get('start')}|{line.get('end')}"
                        if key in session.sent_line_keys:
                            continue
                        session.sent_line_keys.add(key)
                        # 控制集合大小，避免无限增长
                        if len(session.sent_line_keys) > 400:
                            session.sent_line_keys = set(list(session.sent_line_keys)[-300:])
                        try:
                            trans = await translate_deepseek(text, session.target_lang or 'zh')
                        except Exception:
                            trans = text
                        resp_final = {
                            'type': 'final',
                            'text_src': text,
                            'text_opt': text,
                            'text_trans': trans,
                        }
                        # 附加元信息（若存在）
                        for fld in ('start', 'end', 'speaker', 'detected_language'):
                            if fld in line:
                                resp_final[fld] = line[fld]
                        try:
                            await ws.send(json.dumps(resp_final, ensure_ascii=False))
                        except Exception:
                            pass

                # 处理 WLK 的完成信号
                try:
                    if str(data.get('type') or '').lower() == 'ready_to_stop':
                        await ws.send(json.dumps({'type': 'final', 'done': True}))
                except Exception:
                    pass
            # 忽略二进制（WLK 端通常不会推送二进制给客户端）
    except Exception:
        # WLK 连接断开或异常时，提示前端（不中断整体会话）
        try:
            await ws.send(json.dumps({'type': 'error', 'code': 'WLK_DISCONNECTED', 'message': 'WLK 服务连接断开'}))
        except Exception:
            pass

async def handler(ws: WebSocketServerProtocol, path: str):
    # 仅处理指定路径
    if path != WS_PATH:
        await ws.close(code=4000, reason='Invalid path')
        return

    session = SessionState()
    wlk_ws: WebSocketClientProtocol | None = None

    # 首次 ready 信号，前端据此展示“已就绪”提示
    try:
        await ws.send(json.dumps({ 'type': 'ready' }))
    except Exception:
        pass

    try:
        # 建立到 WLK 的上游连接
        wlk_uri = f"ws://{WLK_HOST}:{WLK_PORT}{WLK_WS_PATH}"
        try:
            wlk_ws = await websockets.connect(wlk_uri, max_size=16*1024*1024)
            print(f"[PY] WLK connected {wlk_uri}")
        except Exception:
            await ws.send(json.dumps({ 'type': 'error', 'code': 'WLK_CONNECT_FAIL', 'message': f'无法连接 WLK: {wlk_uri}' }))
            await ws.close(code=1011, reason='Upstream connect failed')
            return

        # 启动 WLK→前端的转发协程
        relay_task = asyncio.create_task(relay_wlk_to_client(wlk_ws, ws, session))

        async for message in ws:
            # 文本消息：协议控制/会话初始化
            if isinstance(message, str):
                try:
                    data = json.loads(message)
                except Exception:
                    continue
                if data.get('type') == 'hello':
                    session.video_url = str(data.get('videoUrl', '') or '')
                    session.is_hls = bool(data.get('isHLS', False))
                    session.target_lang = str(data.get('TargetLang', data.get('targetLang', 'zh')))
                    session.preferred_src_lang = str(data.get('preferredSrcLang', 'auto'))
                    try:
                        print(f"[PY] hello: isHLS={session.is_hls} target={session.target_lang} src={session.preferred_src_lang} video={session.video_url}")
                    except Exception:
                        pass
                    # hello 不必转发给 WLK，上游仅需音频分片
                    continue
                elif data.get('type') == 'close':
                    try:
                        await ws.close()
                    except Exception:
                        pass
                    break
                # 其他文本消息不转发
                continue

            # 二进制消息：前端的音频分片（WebM/Opus 或其他），直接上送 WLK
            if isinstance(message, (bytes, bytearray)):
                try:
                    if wlk_ws is not None:
                        await wlk_ws.send(message)
                        try:
                            print(f"[PY] SEND->WLK chunk bytes={len(message)}")
                        except Exception:
                            pass
                except Exception:
                    # 上游断开，尝试告警并终止会话
                    try:
                        await ws.send(json.dumps({'type': 'error', 'code': 'WLK_SEND_FAIL', 'message': '向 WLK 发送音频失败'}))
                    except Exception:
                        pass
                    break
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
    finally:
        try:
            if wlk_ws is not None:
                await wlk_ws.close()
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