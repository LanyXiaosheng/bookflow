"""番茄小说轻量抓取（纯 HTTP，无需 Playwright）。

直接用 cookie 调 API，不启动浏览器。适合：
- 不想装 500MB Playwright 的用户
- CI/服务器环境
- 快速验证数据

cookie 来源：从浏览器 DevTools 复制，存到 .auth-fanqie/cookies.txt
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

try:
    import requests
except ImportError:
    import urllib.request
    import urllib.error
    requests = None  # type: ignore

from paths import auth_dir, debug_dir

BASE = "https://fanqienovel.com"
SHORT_LIST_API = "/api/author/short_article/list/v0/"
STATS_COMMON_API = "/api/author/sa_stats/common/v0/"
STATS_SINGLE_API = "/api/author/sa_stats/single_common/v0/"
STATS_BY_DATE_API = "/api/author/sa_stats/single_by_date/v0/"

DEFAULT_PARAMS = {
    "aid": "2503",
    "app_name": "muye_novel",
    "page_count": "20",
    "page_index": "0",
    "status": "0",
    "time_sort": "0",
    "image_fmt_list": "450x800",
    "book_image_fmt_list": "190x250",
    "pack_type": "1",
}

HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9",
    "referer": "https://fanqienovel.com/main/writer/short-manage",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
}


def _cookie_path() -> Path:
    return auth_dir() / "cookies.txt"


def _load_cookies() -> str:
    """从 .auth-fanqie/cookies.txt 读 cookie 字符串。"""
    p = _cookie_path()
    if not p.exists():
        raise FileNotFoundError(
            f"Cookie 文件不存在：{p}\n"
            "请从浏览器 DevTools → Network → 任意请求 → Request Headers → Cookie 复制完整值，\n"
            f"粘贴到 {p}"
        )
    raw = p.read_text(encoding="utf-8").strip()
    if not raw:
        raise ValueError(f"Cookie 文件为空：{p}")
    return raw


def _get(path: str, params: dict | None = None, cookies: str | None = None) -> dict:
    """发 GET 请求，返回 JSON。"""
    cookie_str = cookies or _load_cookies()
    url = BASE + path
    if params:
        url += "?" + urlencode(params)

    headers = {**HEADERS, "cookie": cookie_str}

    if requests:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        return resp.json()
    else:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))


def fetch_works(page_index: int = 0, page_count: int = 20, cookies: str | None = None) -> dict:
    """拉短篇作品列表。"""
    params = {**DEFAULT_PARAMS, "page_index": str(page_index), "page_count": str(page_count)}
    return _get(SHORT_LIST_API, params, cookies)


def fetch_all_works(cookies: str | None = None) -> list[dict]:
    """翻页拉全量作品。"""
    cookie_str = cookies or _load_cookies()
    all_works: list[dict] = []
    page = 0
    while True:
        data = fetch_works(page_index=page, page_count=10, cookies=cookie_str)
        if data.get("code") != 0:
            print(f"[错误] API 返回 code={data.get('code')}, message={data.get('message')}")
            break
        items = (data.get("data") or {}).get("item_list") or []
        if not items:
            break
        for w in items:
            all_works.append(_normalize_work(w))
        total = (data.get("data") or {}).get("total_count") or 0
        if len(all_works) >= total:
            break
        page += 1
        time.sleep(1)
    return all_works


def _normalize_work(w: dict) -> dict:
    """标准化字段（与 crawler.py 输出一致）。"""
    multi_title = w.get("multi_title") or []
    title = multi_title[0] if multi_title else (w.get("title") or "")

    categories = w.get("category") or []
    category_names = [c.get("name", "") for c in categories if isinstance(c, dict)]

    read_raw = w.get("read_count") or "0"
    read_count = int(read_raw) if isinstance(read_raw, str) else (read_raw or 0)

    create_raw = w.get("create_time") or "0"
    create_time = int(create_raw) if isinstance(create_raw, str) else (create_raw or 0)

    modify_raw = w.get("modify_time") or "0"
    modify_time = int(modify_raw) if isinstance(modify_raw, str) else (modify_raw or 0)

    return {
        "work_id": str(w.get("book_id") or w.get("item_id") or ""),
        "item_id": str(w.get("item_id") or ""),
        "title": title,
        "create_time": create_time,
        "update_time": modify_time,
        "word_count": w.get("word_number") or w.get("word_count") or 0,
        "read_count": read_count,
        "category": " / ".join(category_names[:3]) if category_names else "",
        "sign_status": w.get("sign_status") or 0,
        "sign_status_text": w.get("sign_status_text") or "",
        "display_status": w.get("display_status") or 0,
        "is_data_show": w.get("is_data_show") or 0,
        "collect_count": 0,
        "comment_count": 0,
        "like_count": 0,
        "reward_count": 0,
    }


def fetch_account_stats(cookies: str | None = None) -> dict:
    """账号总览数据。"""
    params = {"aid": "2503", "app_name": "muye_novel"}
    data = _get(STATS_COMMON_API, params, cookies)
    if data.get("code") != 0:
        return {}
    return data.get("data") or {}


def fetch_work_stats(book_id: str, cookies: str | None = None) -> dict:
    """单篇作品统计数据（含点赞/评论/收藏/曝光/点击率）。"""
    params = {"aid": "2503", "app_name": "muye_novel", "book_id": book_id}
    data = _get(STATS_SINGLE_API, params, cookies)
    if data.get("code") != 0:
        return {}
    raw = data.get("data") or {}
    return {
        "read_count": _safe_int(raw.get("read_count")),
        "show_count": _safe_int(raw.get("show_count")),
        "click_rate": raw.get("click_rate") or "",
        "digg_count": _safe_int(raw.get("digg_count")),
        "comment_count": _safe_int(raw.get("comment_count")),
        "shelf_count": _safe_int(raw.get("shelf_count")),
        "read_count_increase": _safe_int(raw.get("read_count_increase")),
        "show_count_increase": _safe_int(raw.get("show_count_increase")),
        "raw": raw,
    }


def fetch_work_daily(book_id: str, date_ts: int, cookies: str | None = None) -> dict:
    """单篇按日数据（含完读率、留存）。"""
    params = {
        "aid": "2503", "app_name": "muye_novel",
        "book_id": book_id,
        "start_date": str(date_ts),
        "end_date": str(date_ts),
    }
    data = _get(STATS_BY_DATE_API, params, cookies)
    if data.get("code") != 0:
        return {}
    raw = data.get("data") or {}
    read = _safe_int(raw.get("read_count"))
    read_100 = _safe_int(raw.get("read_100_percent_count"))
    read_15s = _safe_int(raw.get("read_count_15s"))
    read_30s = _safe_int(raw.get("read_count_30s"))
    read_60s = _safe_int(raw.get("read_count_60s"))
    return {
        "read_count": read,
        "show_count": _safe_int(raw.get("show_count")),
        "read_100_percent": read_100,
        "completion_rate": f"{read_100/read*100:.1f}%" if read else "-",
        "retention_15s": f"{read_15s/read*100:.1f}%" if read else "-",
        "retention_30s": f"{read_30s/read*100:.1f}%" if read else "-",
        "retention_60s": f"{read_60s/read*100:.1f}%" if read else "-",
        "cumulative_read": _safe_int(raw.get("yesterday_sum_read_count")),
        "cumulative_show": _safe_int(raw.get("yesterday_sum_show_count")),
        "raw": raw,
    }


def fetch_all_works_with_stats(cookies: str | None = None) -> list[dict]:
    """拉全量作品并补充统计数据。"""
    cookie_str = cookies or _load_cookies()
    works = fetch_all_works(cookie_str)
    for w in works:
        if w.get("is_data_show"):
            stats = fetch_work_stats(w["work_id"], cookie_str)
            if stats:
                w["digg_count"] = stats.get("digg_count", 0)
                w["comment_count"] = stats.get("comment_count", 0)
                w["collect_count"] = stats.get("shelf_count", 0)
                w["show_count"] = stats.get("show_count", 0)
                w["click_rate"] = stats.get("click_rate", "")
            time.sleep(0.5)
    return works


def _safe_int(val) -> int:
    if val is None or val == "":
        return 0
    try:
        return int(val)
    except (ValueError, TypeError):
        try:
            return int(float(val))
        except (ValueError, TypeError):
            return 0


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "all":
        works = fetch_all_works()
        print(f"共 {len(works)} 篇作品：\n")
        for i, w in enumerate(works):
            print(f"[{i:2d}] {w['work_id']}  阅读:{w['read_count']:>6}  字数:{w['word_count']:>6}  {w['title'][:40]}")
    elif len(sys.argv) > 1 and sys.argv[1] == "json":
        works = fetch_all_works()
        print(json.dumps(works, ensure_ascii=False, indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] == "stats":
        book_id = sys.argv[2] if len(sys.argv) > 2 else None
        if book_id:
            s = fetch_work_stats(book_id)
            print(json.dumps(s, ensure_ascii=False, indent=2))
        else:
            s = fetch_account_stats()
            print(json.dumps(s, ensure_ascii=False, indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] == "daily":
        if len(sys.argv) < 4:
            print("Usage: python crawler_lite.py daily <book_id> <timestamp>")
            sys.exit(1)
        s = fetch_work_daily(sys.argv[2], int(sys.argv[3]))
        print(json.dumps(s, ensure_ascii=False, indent=2))
    else:
        data = fetch_works(page_index=0, page_count=10)
        if data.get("code") == 0:
            items = (data.get("data") or {}).get("item_list") or []
            total = (data.get("data") or {}).get("total_count") or 0
            print(f"共 {total} 篇，显示前 {len(items)} 篇：\n")
            for i, w in enumerate(items):
                nw = _normalize_work(w)
                print(f"[{i}] {nw['work_id']}  阅读:{nw['read_count']:>6}  字数:{nw['word_count']:>6}  {nw['title'][:40]}")
        else:
            print(f"API 错误：{data}")
            sys.exit(1)

    if "--quiet" not in sys.argv:
        print(f"\n提示：cookie 文件位于 {_cookie_path()}")
