import json
import sys
from pathlib import Path

import httpx

import os

# Simple DeepSeek API connectivity test script
# Reads secrets from ../local-deploy/.secrets or environment variables
# Sends a minimal chat-completions request to verify key/endpoint/model


def read_secret_from_files(base_dir: Path, name: str) -> str:
    """Read secret value from local-deploy/.secrets/<NAME>.txt if exists."""
    try:
        secrets_dir = (base_dir / 'local-deploy' / '.secrets')
        file_path = secrets_dir / f'{name}.txt'
        if file_path.exists():
            return file_path.read_text(encoding='utf-8').strip()
    except Exception:
        pass
    return ''


def normalize_endpoint(ep: str) -> str:
    ep = (ep or '').strip().rstrip('/')
    if not ep:
        return ep
    # Ensure /v1/chat/completions suffix
    if not ep.endswith('/chat/completions'):
        if ep.endswith('/v1'):
            ep = ep + '/chat/completions'
        else:
            ep = ep + '/v1/chat/completions'
    return ep


def main():
    base_dir = Path(__file__).resolve().parents[1]
    # Prefer secrets files; fallback to env
    api_key = read_secret_from_files(base_dir, 'DEEPSEEK_API_KEY') or os.environ.get('DEEPSEEK_API_KEY', '')
    endpoint = read_secret_from_files(base_dir, 'DEEPSEEK_ENDPOINT') or os.environ.get('DEEPSEEK_ENDPOINT', '')
    model = read_secret_from_files(base_dir, 'DEEPSEEK_MODEL') or os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat')

    if not api_key:
        print('[TEST][DeepSeek] Missing API key. Put it in local-deploy/.secrets/DEEPSEEK_API_KEY.txt')
        sys.exit(1)
    if not endpoint:
        print('[TEST][DeepSeek] Missing endpoint. Put it in local-deploy/.secrets/DEEPSEEK_ENDPOINT.txt')
        sys.exit(1)

    ep = normalize_endpoint(endpoint)

    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }
    payload = {
        'model': model,
        'temperature': 0,
        'messages': [
            {
                'role': 'system',
                'content': 'You are a professional translation engine. Translate the user text into Simplified Chinese. Output only the translated text.'
            },
            {
                'role': 'user',
                'content': 'こんにちは'  # simple Japanese greeting; expected output: 你好 / 你好啊
            }
        ]
    }

    insecure = os.environ.get('INSECURE', '')
    verify_flag = False if insecure else True
    print(f"[TEST][DeepSeek] INSECURE={'1' if not verify_flag else '0'} (set env INSECURE=1 to bypass TLS cert)")

    print(f"[TEST][DeepSeek] POST {ep} model={model} payload_len={len(json.dumps(payload))}")
    try:
        with httpx.Client(timeout=httpx.Timeout(20.0), http2=False, verify=verify_flag, trust_env=False) as client:
            r = client.post(ep, headers=headers, json=payload)
            print(f"[TEST][DeepSeek] status={r.status_code}")
            # Show a compact preview of response body
            body_preview = r.text[:500]
            print(f"[TEST][DeepSeek] body_preview=\n{body_preview}")
            r.raise_for_status()
            data = r.json()
            translated = None
            if isinstance(data, dict) and data.get('choices'):
                msg = data['choices'][0].get('message') or {}
                translated = (msg.get('content') or '').strip()
            elif isinstance(data, dict) and 'output_text' in data:
                translated = str(data['output_text']).strip()
            else:
                translated = None
            if translated:
                print(f"[TEST][DeepSeek] translated=\n{translated}")
                print('[TEST][DeepSeek] SUCCESS: API key/endpoint/model appear to work.')
                sys.exit(0)
            else:
                print('[TEST][DeepSeek] FAIL: No translated content parsed from response.')
                sys.exit(2)
    except Exception as e:
        print(f"[TEST][DeepSeek] EXCEPTION: {e}")
        print("[TEST][DeepSeek] Hints: If you are behind a corporate proxy or TLS-inspecting firewall, try setting INSECURE=1 and re-run. Also ensure your Python/OpenSSL supports TLS 1.2/1.3.")
        sys.exit(3)


if __name__ == '__main__':
    main()