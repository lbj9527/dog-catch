#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MissAV 单演员抓取脚本（里程碑1：功能通）
- 输入：--actress-url 指向某位演员的详情页
- 处理：遍历该演员的所有分页，提取每个视频标题，并从标题中解析番号
- 输出：CSV（固定写入 E:\pythonProject\chrome-extension\dog-catch\subtitlescript\output\actor_[URL最后一段中文名].csv）

用法示例：
  python userscript/videoID-spider.py --actress-url "https://missav.live/cn/actress/xxxxx" \
      --concurrency 2 --delay 1 --retries 2

注意：
- 需要在 userscript 目录下的虚拟环境中安装依赖（见 userscript/requirements.txt）
- 本脚本仅做最小可用实现，分页与结构解析尽量通用且稳健，但若站点结构调整，请据实际页面调整选择器
"""

import argparse
import csv
import sys
import time
import re
import os
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse, urlunparse, parse_qs, urlencode, unquote
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

try:
    import cloudscraper  # type: ignore
    HAS_CLOUDSCRAPER = True
except Exception:
    HAS_CLOUDSCRAPER = False

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
    # Added browser-like headers to better mimic real navigation
    "Upgrade-Insecure-Requests": "1",
    "Referer": "https://missav.live/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    # Additional headers for realism
    "Accept-Encoding": "gzip, deflate",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "DNT": "1",
    "priority": "u=0, i",
}

ID_PATTERNS = [
    # 标准番号：如 SSIS-123 / IPX-777 / SSIS-123R
    (re.compile(r"\b([A-Z]{2,6})[-_ ]?(\d{2,5})([A-Z]?)\b", re.I), "standard"),
    # FC2：FC2-PPV-1234567 或 FC2-1234567
    (re.compile(r"\bFC2(?:-PPV)?-(\d{4,8})\b", re.I), "fc2"),
]


def normalize_video_id(text: str):
    """从文本中提取第一个可识别番号，返回 (id, type)；若失败，返回 ("", "unknown")."""
    if not text:
        return "", "unknown"
    for pat, ptype in ID_PATTERNS:
        m = pat.search(text)
        if m:
            if ptype == "standard":
                prefix = m.group(1).upper()
                num = m.group(2)
                suffix = (m.group(3) or "").upper()
                base = f"{prefix}-{num}"
                return (base + suffix) if suffix else base, ptype
            elif ptype == "fc2":
                number = m.group(1)
                # 保持常见形式：FC2-PPV-xxxxxx（若原文本出现了 PPV）/ 否则 FC2-xxxxxx
                if re.search(r"FC2-PPV", text, re.I):
                    return f"FC2-PPV-{number}", ptype
                return f"FC2-{number}", ptype
    return "", "unknown"


def build_session(timeout: int):
     # Prefer cloudscraper to better handle CF; fallback to requests.Session
     s = cloudscraper.create_scraper() if HAS_CLOUDSCRAPER else requests.Session()
     s.headers.update(DEFAULT_HEADERS)
     s.timeout = timeout
     # Hardcode SOCKS5 proxy as requested
     s.trust_env = False
     s.proxies = {
        "http": "socks5h://127.0.0.1:7890",
        "https": "socks5h://127.0.0.1:7890",
    }
     # Hardcode Cookie for missav.live to bypass age/WAF as requested (synced from user's browser cURL)
     s.headers["Cookie"] = (
        "_ga=GA1.1.1460353902.1754443204; "
        "user_uuid=0513eb96-1d67-4827-8edd-cc506a99f450; "
        "remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=eyJpdiI6IkIwMkRURVM5dDUxUVFxL1FRSVkyVWc9PSIsInZhbHVlIjoiK2dudFBDNXAzbktXU1VHUXJEL3Q1M3hRbVRlMGRWT1paZ09PdHhzdHFxaEs1QXdEK2FMeWFHOFVuamllZWNlTG53aFBVTVFIaFpndTZ4aElITTU0ZUFZUlFnMk5sVkVkaEllaHRPN3JaWHZaT01QdVBDYUVhUUlaaStJZFBUMVcxNThMRFVad0hURWxHemlQMklxVUpQUGFCeTF6VGZaTXVsdVo2N1E1TFhrNlRJbEtCRDZlWFFpbXlnN0ZqZERvcmE4Z3RHNGtUM3loS2Q3T1ArNWpEN1JJVlZGYWYwVmhHYUhCWkxBY3hDUT0iLCJtYWMiOiJjZDQzMGU1OTNkMzU2ZGY0Mjg5N2Q4NTUyOGRlNTQ5MjM2MGM4N2U1YjIzNzJhNWRmZmVhNDE5OWJmMmQzZDI4IiwidGFnIjoiIn0%3D; "
        "search_history=[%22%25E4%25B8%2583%25E6%25B5%25B7%22,%22nima027%22,%22Uncensored%22,%22abp968%22,%22ABP-023%22]; "
        "cf_clearance=hzAljIAiKx1mz1NhrfbpKe8ljMLRc01pi6bTeoaz5Nw-1758198578-1.2.1.1-9YaV5AOCzUNyARxTPsNjm2hB48Myl_qV84RljiCKECWG1FkB7nc.3KHs3SRqW9nV03P_y.QAOwDBpXX.E5ttz.jE8doUdmZQKrltUIZJhBLtcxN2kRYiMQwtxU9nc_TJD.lttqW7LSH4SoCo5ycDrUYoNj31R8TyTBMjj4QJbEE4B2pymsnMn7mS83pE5vXNXZ6iTUfvKVmtHjlDA.Ezafubj.z8zIImkE7q6eLlwjQ; "
        "_ga_JV54L39Q8H=GS2.1.s1758192962$o107$g1$t1758198766$j60$l0$h0"
     )
     return s


def sleep_delay(delay: float):
    try:
        time.sleep(max(0.0, float(delay)))
    except Exception:
        time.sleep(1.0)


def http_get(session: requests.Session, url: str, timeout: int, delay: float, retries: int):
    last_err = None
    for attempt in range(retries + 1):
        # 基础限速：每次尝试前都等待 delay 秒（含首次尝试）
        sleep_delay(delay)
        try:
            resp = session.get(url, timeout=timeout, allow_redirects=True)
            # 对 5xx 做重试
            if 500 <= resp.status_code < 600:
                last_err = RuntimeError(f"HTTP {resp.status_code}")
            else:
                return resp
        except requests.RequestException as e:
            last_err = e
    raise last_err if last_err else RuntimeError("Unknown HTTP error")


def extract_actress_name(soup: BeautifulSoup) -> str:
    # og:title 优先
    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        return og["content"].strip()
    # title 次之
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    # h1/h2 兜底
    for tag in soup.select("h1, h2"):
        txt = tag.get_text(strip=True)
        if txt:
            return txt
    return ""


def extract_video_items(soup: BeautifulSoup, base_url: str):
    """从演员页中提取视频条目：优先从 a 标签文本中匹配番号。返回 [(title, url) ...]"""
    items = []
    seen = set()

    # 1) 优先：a 标签文本包含番号
    for a in soup.find_all("a"):
        txt = a.get_text(" ", strip=True)
        if not txt:
            continue
        vid, _ = normalize_video_id(txt)
        if not vid:
            continue
        href = a.get("href") or ""
        abs_url = urljoin(base_url, href) if href else ""
        key = abs_url or (txt + "|" + base_url)
        if key in seen:
            continue
        seen.add(key)
        items.append((txt, abs_url))

    # 2) 兜底：带有 title 字样的元素文本
    for tag in soup.find_all(lambda t: t.has_attr("class") and any("title" in c.lower() for c in t.get("class", []))):
        txt = tag.get_text(" ", strip=True)
        if not txt:
            continue
        vid, _ = normalize_video_id(txt)
        if not vid:
            continue
        # 尝试找最近的链接
        a = tag.find("a") or tag.find_parent("a")
        href = a.get("href") if a else ""
        abs_url = urljoin(base_url, href) if href else ""
        key = abs_url or (txt + "|" + base_url)
        if key in seen:
            continue
        seen.add(key)
        items.append((txt, abs_url))

    return items


def find_pagination_urls(soup: BeautifulSoup, actress_url: str, max_pages: int):
    """从第一页解析出最大页码，并生成 1..N 的完整分页链接列表（受 max_pages 限制）。
    若页面未出现任何分页线索，则仅返回 [actress_url]。
    """
    # 统一只在同一演员路径下取分页链接
    def same_actor_path(u: str) -> bool:
        try:
            p1 = urlparse(u).path.split("/")[:4]
            p2 = urlparse(actress_url).path.split("/")[:4]
            return p1 == p2
        except Exception:
            return False

    numbers = set([1])
    style = None  # 'query' or 'path'

    for a in soup.find_all("a"):
        href = a.get("href") or ""
        if not href:
            continue
        abs_url = urljoin(actress_url, href)
        if not abs_url.startswith("http"):
            continue
        if not same_actor_path(abs_url):
            continue

        # 1) 从链接本身解析 ?page=N 或 /page/N
        m = re.search(r"(?:[?&]page=)(\d+)", abs_url)
        if m:
            numbers.add(int(m.group(1)))
            if style is None:
                style = "query"
        else:
            m2 = re.search(r"/page/(\d+)", abs_url)
            if m2:
                numbers.add(int(m2.group(1)))
                if style is None:
                    style = "path"

        # 2) 纯数字的页码文本
        text = (a.get_text(strip=True) or "").strip()
        if text.isdigit():
            try:
                numbers.add(int(text))
            except Exception:
                pass

        # 3) “下一页/末页”等提示文本不增加页码，但保留 style 的线索
        low = text.lower()
        if any(t in low for t in ["next", "下一页", ">", "»", "last", "末页", "最后"]):
            if style is None:
                # 如果链接里带了 page 参数，前面的分支已经设置 style；
                # 这里兜底按 query 风格（MissAV 当前为 query 风格）
                style = "query"

    max_num = max(numbers) if numbers else 1
    max_num = min(max_num, max_pages)

    # 生成完整分页 URL 列表
    urls = []
    if style == "path":
        # /.../page/N 风格
        base = urlparse(actress_url)
        base_path = base.path.rstrip("/")
        for i in range(1, max_num + 1):
            if i == 1:
                urls.append(actress_url)
            else:
                new_path = f"{base_path}/page/{i}"
                urls.append(urlunparse((base.scheme, base.netloc, new_path, "", "", "")))
    else:
        # 默认和 MissAV 一致：?page=N 风格
        parsed = urlparse(actress_url)
        base_q = parse_qs(parsed.query)
        base_q.pop("page", None)
        # page=1 使用原始 URL，其余使用 ?page=i
        urls.append(urlunparse(parsed._replace(query=urlencode(base_q, doseq=True))))
        for i in range(2, max_num + 1):
            q = {**base_q, "page": [i]}
            urls.append(urlunparse(parsed._replace(query=urlencode(q, doseq=True))))

    return urls


def ensure_output_dir(path: str):
    d = os.path.dirname(os.path.abspath(path))
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)


def write_csv(rows, output_path: str):
    ensure_output_dir(output_path)
    headers = [
        "video_title",
        "video_url",
        "video_type",
        "video_id",
        "id_pattern_type",
        "page_no",
    ]
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        for r in rows:
            w.writerow(r)


# 新增：从 URL 推导演员名（中文），并清洗为合法文件名
def derive_actor_name_from_url(url: str) -> str:
    try:
        path = urlparse(url).path or ""
        if path.endswith("/"):
            path = path[:-1]
        last = path.rsplit("/", 1)[-1] if path else ""
        name = unquote(last).strip()
        return name or "unknown"
    except Exception:
        return "unknown"


def sanitize_filename(name: str, max_len: int = 80) -> str:
    invalid = r'<>:"/\\|?*'
    trans = str.maketrans({ch: "_" for ch in invalid})
    s = name.translate(trans)
    s = s.rstrip(" .")
    if len(s) > max_len:
        s = s[:max_len].rstrip(" .")
    return s or "unknown"


def crawl_actress(actress_url: str, concurrency: int, delay: float, retries: int, timeout: int, max_pages: int):
    session = build_session(timeout)

    # Warm up session with site homepage to simulate in-site navigation
    try:
        sleep_delay(delay)
        session.get("https://missav.live/", timeout=timeout, allow_redirects=True)
    except Exception as e:
        print(f"[WARN] Warmup request failed: {e}")

    # If visiting /dm18/ path, warm up the dm18 gateway and set referer accordingly
    if "/dm18/" in actress_url:
        try:
            sleep_delay(delay)
            session.get("https://missav.live/dm18/", timeout=timeout, allow_redirects=True)
            # Prefer language-switch referer if target is cn/actresses -> en/actresses
            ref = None
            if "/dm18/cn/actresses/" in actress_url:
                ref = actress_url.replace("/dm18/cn/actresses/", "/dm18/en/actresses/", 1)
            if not ref:
                ref = "https://missav.live/dm18/"
            # Try visiting referer once to simulate in-site navigation
            try:
                sleep_delay(delay)
                session.get(ref, timeout=timeout, allow_redirects=True)
            except Exception:
                pass
            session.headers["Referer"] = ref
        except Exception as e:
            print(f"[WARN] DM18 warmup failed: {e}")

    # 获取第一页
    resp = http_get(session, actress_url, timeout, delay, retries)

    # If first attempt gets 403, try re-warmup once and retry
    if resp.status_code == 403:
        print("[WARN] First page HTTP 403, re-warmup and retry once...")
        try:
            sleep_delay(delay)
            session.get("https://missav.live/", timeout=timeout, allow_redirects=True)
            if "/dm18/" in actress_url:
                sleep_delay(delay)
                session.get("https://missav.live/dm18/", timeout=timeout, allow_redirects=True)
                ref = None
                if "/dm18/cn/actresses/" in actress_url:
                    ref = actress_url.replace("/dm18/cn/actresses/", "/dm18/en/actresses/", 1)
                if not ref:
                    ref = "https://missav.live/dm18/"
                try:
                    sleep_delay(delay)
                    session.get(ref, timeout=timeout, allow_redirects=True)
                except Exception:
                    pass
                session.headers["Referer"] = ref
        except Exception as e:
            print(f"[WARN] Re-warmup failed: {e}")
        # retry once
        resp = http_get(session, actress_url, timeout, delay, retries)

    if resp.status_code != 200:
        print(f"[ERROR] First page HTTP {resp.status_code}", file=sys.stderr)
        return 1
    soup = BeautifulSoup(resp.text, "html.parser")
    actress_name = extract_actress_name(soup)

    page_urls = find_pagination_urls(soup, actress_url, max_pages=max_pages)
    if not page_urls:
        page_urls = [actress_url]

    print(f"[INFO] Actress: {actress_name or 'N/A'} | Pages discovered: {len(page_urls)}")

    fetched = {}
    results = []
    fetched_at = datetime.now(timezone.utc).isoformat()

    def fetch_one(page_url):
        r = http_get(session, page_url, timeout, delay, retries)
        s = BeautifulSoup(r.text, "html.parser")
        items = extract_video_items(s, page_url)
        return page_url, items

    # 并发抓取分页
    with ThreadPoolExecutor(max_workers=max(1, int(concurrency))) as ex:
        future_to_url = {ex.submit(fetch_one, u): u for u in page_urls}
        for fut in as_completed(future_to_url):
            u = future_to_url[fut]
            try:
                page_url, items = fut.result()
                fetched[page_url] = items
                print(f"[INFO] Page ok: {page_url} | items: {len(items)}")
            except Exception as e:
                print(f"[WARN] Page failed: {u} | {e}")

    # 去重并写行
    seen_keys = set()
    for idx, u in enumerate(sorted(fetched.keys()), start=1):
        items = fetched[u]
        for title, vurl in items:
            vid, ptype = normalize_video_id(title)
            key = vurl or (title + "|" + actress_url)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            vtype = "普通"
            if vurl and "uncensored-leak" in vurl:
                vtype = "无码破解"
            elif vurl and "chinese-subtitle" in vurl:
                vtype = "中文字幕"
            results.append({
                "video_title": title,
                "video_url": vurl,
                "video_type": vtype,
                "video_id": vid,
                "id_pattern_type": ptype if vid else "unknown",
                "page_no": idx,
            })

    # 计算固定输出路径：E:\...\output\actor_[URL最后一段中文名].csv
    out_dir = r"E:\pythonProject\chrome-extension\dog-catch\subtitlescript\output"
    raw_name = derive_actor_name_from_url(actress_url)
    safe_name = sanitize_filename(raw_name)
    out_path = os.path.join(out_dir, f"actor_{safe_name}.csv")

    write_csv(results, out_path)
    print(f"[DONE] Rows: {len(results)} | Output: {os.path.abspath(out_path)}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="MissAV 单演员抓取，提取视频标题并解析番号，输出为CSV")
    parser.add_argument("--actress-url", required=True, help="演员详情页 URL，例如 https://missav.live/cn/actress/xxxxx")
    # 移除 --output 参数，统一固定输出路径
    parser.add_argument("--concurrency", type=int, default=2, help="并发数，默认2")
    parser.add_argument("--delay", type=float, default=1.0, help="每次请求的基础延迟秒，默认1.0")
    parser.add_argument("--retries", type=int, default=2, help="失败重试次数，默认2")
    parser.add_argument("--timeout", type=int, default=15, help="单请求超时秒，默认15")
    parser.add_argument("--max-pages", type=int, default=200, help="最多抓取的分页页数上限，默认200")
    args = parser.parse_args()

    try:
        code = crawl_actress(
            actress_url=args.actress_url,
            concurrency=args.concurrency,
            delay=args.delay,
            retries=args.retries,
            timeout=args.timeout,
            max_pages=args.max_pages,
        )
        sys.exit(code)
    except KeyboardInterrupt:
        print("[INTERRUPTED] by user", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()