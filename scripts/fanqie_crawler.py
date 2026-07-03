#!/usr/bin/env python3
"""
番茄小说作家后台数据抓取脚本。

用法：
  python fanqie_crawler.py --cookies "your_cookie_string" --aid YOUR_AID

输出 JSON 格式与 /api/fanqie/fetch-all 响应一致，可直接被 bookflow 消费。

--cookies  浏览器开发者工具 → Network → 任意番茄请求的 Cookie 请求头值
--aid      番茄作家 aid（URL 或接口参数里的数字 ID）
--days     统计最近 N 天的数据（默认 7）
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Optional

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
BASE = "https://fanqienovel.com"


def get(url: str, cookies: str, referer: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "accept": "application/json",
            "user-agent": UA,
            "referer": referer,
            "cookie": cookies,
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def fetch_list(aid: str, cookies: str) -> list[dict]:
    url = (
        f"{BASE}/api/author/short_article/list/v0/"
        f"?aid={aid}&app_name=muye_novel&page_count=50&page_index=0"
        f"&status=0&time_sort=0&image_fmt_list=450x800&book_image_fmt_list=190x250&pack_type=1"
    )
    referer = f"{BASE}/main/writer/short-manage"
    data = get(url, cookies, referer)
    if data.get("code") != 0:
        msg = data.get("message", "unknown")
        raise RuntimeError(f"番茄 list API 返回错误 code={data.get('code')}: {msg}（cookies 可能已过期）")
    return data.get("data", {}).get("item_list", [])


def fetch_detail(aid: str, book_id: str, cookies: str, start_ts: int, end_ts: int) -> Optional[dict]:
    """尝试两个接口；都失败则返回 None。"""
    referer = f"{BASE}/main/writer/short-data?bookId={book_id}&tab=2"
    urls = [
        (
            f"{BASE}/api/author/sa_stats/single_by_date/v0/"
            f"?aid={aid}&app_name=muye_novel&book_id={book_id}"
            f"&start_date={start_ts}&end_date={end_ts}"
        ),
        (
            f"{BASE}/api/author/stats/book_increase_v2/v0/"
            f"?aid={aid}&app_name=muye_novel&book_id={book_id}"
            f"&start_date={start_ts}&end_date={end_ts}&stats_types=32"
        ),
    ]
    for url in urls:
        try:
            data = get(url, cookies, referer)
            row = data.get("data", {})
            if not row:
                continue
            # 兼容 data_list 表格格式和 object 格式
            if "data_list" in row:
                rows = row["data_list"]
                if rows and isinstance(rows[0], list):
                    r = rows[0]
                    return {
                        "show_count": _int(r[2]) if len(r) > 2 else None,
                        "completion_rate": _ratio(r[1]) if len(r) > 1 else None,
                        "comment_count": _int(r[4]) if len(r) > 4 else None,
                        "like_count": _int(r[5]) if len(r) > 5 else None,
                        "library_count": _int(r[6]) if len(r) > 6 else None,
                    }
            return {
                "show_count": _first_int(row, ["show_count", "show_cnt", "impression_count"]),
                "completion_rate": _first_ratio(row, ["completion_rate", "finish_rate", "read_finish_rate"]),
                "comment_count": _first_int(row, ["comment_count", "comment_cnt"]),
                "like_count": _first_int(row, ["like_count", "like_cnt"]),
                "library_count": _first_int(row, ["library_count", "bookshelf_count", "shelf_count"]),
            }
        except Exception:
            continue
    return None


def _int(v) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _ratio(v) -> Optional[float]:
    try:
        f = float(v)
        return f / 100 if f > 1 else f
    except (TypeError, ValueError):
        return None


def _first_int(d: dict, keys: list[str]) -> Optional[int]:
    for k in keys:
        if k in d:
            return _int(d[k])
    return None


def _first_ratio(d: dict, keys: list[str]) -> Optional[float]:
    for k in keys:
        if k in d:
            return _ratio(d[k])
    return None


def main():
    parser = argparse.ArgumentParser(description="番茄小说作家数据抓取")
    parser.add_argument("--cookies", required=True, help="浏览器 Cookie 字符串")
    parser.add_argument("--aid", required=True, help="番茄作家 aid")
    parser.add_argument("--days", type=int, default=7, help="统计最近 N 天（默认 7）")
    args = parser.parse_args()

    now = datetime.now(tz=timezone.utc)
    end_ts = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    start_ts = end_ts - args.days * 86400

    items_raw = fetch_list(args.aid, args.cookies)

    items = []
    detail_success = 0
    detail_failed = 0
    errors = []

    for raw in items_raw:
        book_id = raw.get("book_id", "")
        title = (
            (raw.get("multi_title") or [{}])[0].get("title")
            or raw.get("title", "(无标题)")
        )
        read_count = int(raw.get("read_count") or 0)
        word_number = int(raw.get("word_number") or 0)
        categories = [c["name"] for c in (raw.get("category") or []) if "name" in c]

        detail = fetch_detail(args.aid, book_id, args.cookies, start_ts, end_ts)
        if detail:
            detail_success += 1
        else:
            detail_failed += 1
            errors.append(f"{title}: 明细抓取失败")
            detail = {}

        items.append({
            "book_id": book_id,
            "title": title,
            "read_count": read_count,
            "word_number": word_number,
            "categories": categories,
            "show_count": detail.get("show_count"),
            "completion_rate": detail.get("completion_rate"),
            "comment_count": detail.get("comment_count"),
            "like_count": detail.get("like_count"),
            "library_count": detail.get("library_count"),
        })
        time.sleep(0.2)  # 礼貌间隔

    result = {
        "items": items,
        "total_count": len(items),
        "detail_success": detail_success,
        "detail_failed": detail_failed,
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
