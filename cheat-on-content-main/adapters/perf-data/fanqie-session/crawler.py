"""番茄小说创作中心数据抓取。

登录一次后，Cookie 持久化在 .auth-fanqie/，之后直接复用。
番茄小说（fanqienovel.com）是字节跳动旗下网文平台，
创作者中心在 fanqienovel.com/main/writer/。

已验证 API：
- 短篇列表：/api/author/short_article/list/v0/
- 数据结构：data.item_list[]，字段见 _normalize_work()
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from playwright.async_api import BrowserContext, Page, Response, async_playwright
from paths import auth_dir, debug_dir

CREATOR_HOME = "https://fanqienovel.com/main/writer"
CREATOR_SHORT_MANAGE = "https://fanqienovel.com/main/writer/short-manage"


class Session:
    """单浏览器会话，按顺序跑多步抓取。"""

    def __init__(self, ctx: BrowserContext, pw: Any) -> None:
        self.ctx = ctx
        self.pw = pw

    @classmethod
    async def open(cls, headless: bool = False) -> Session:
        pw = await async_playwright().start()
        auth_path = auth_dir()
        auth_path.mkdir(exist_ok=True)
        ctx = await pw.chromium.launch_persistent_context(
            user_data_dir=str(auth_path),
            headless=headless,
            viewport={"width": 1440, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        return cls(ctx, pw)

    async def close(self) -> None:
        try:
            await self.ctx.close()
        finally:
            await self.pw.stop()


async def ensure_login(timeout_s: int = 300) -> bool:
    """扫码/账密登录；检测到登录态后自动关闭。"""
    sess = await Session.open()
    try:
        page = await sess.ctx.new_page()
        await page.goto(CREATOR_HOME)
        print(f"[登录] 在弹出的 Chromium 窗口里登录番茄小说创作者中心。最多等 {timeout_s} 秒……")
        for i in range(timeout_s):
            try:
                cookies = await sess.ctx.cookies("https://fanqienovel.com")
                has_session = any(
                    c["name"] in ("sessionid", "sessionid_ss", "sid_tt", "uid_tt")
                    for c in cookies
                )
                current_url = page.url
                if has_session and "login" not in current_url:
                    print(f"[登录] ✓ 检测到登录态（用时 {i}s）")
                    await asyncio.sleep(1)
                    return True
            except Exception:
                pass
            await asyncio.sleep(1)
        print("[登录] 超时未检测到登录态。")
        return False
    finally:
        await sess.close()


async def fetch_recent_works(sess: Session, limit: int = 50) -> list[dict]:
    """从创作者中心拉最近作品列表（短篇管理页）。

    拦截 /api/author/short_article/list/v0/ 接口。
    """
    captured: list[dict] = []
    all_urls: list[str] = []

    page = await sess.ctx.new_page()

    async def on_response(resp: Response) -> None:
        all_urls.append(resp.url)
        if any(k in resp.url for k in (
            "/api/author/short_article/list",
            "/api/author/work/list",
            "/api/creator/work",
            "work_list",
            "item_list",
        )):
            try:
                data = await resp.json()
                captured.append({"url": resp.url, "data": data})
            except Exception:
                pass

    page.on("response", on_response)
    try:
        await page.goto(CREATOR_SHORT_MANAGE, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(8)
        # 滚动触发翻页加载
        for _ in range(3):
            await page.evaluate("window.scrollBy(0, 1200)")
            await asyncio.sleep(1.5)
        works = _parse_work_list(captured, limit)
        if not works:
            dbg = debug_dir()
            dbg.mkdir(parents=True, exist_ok=True)
            (dbg / "creator_urls.txt").write_text("\n".join(all_urls), encoding="utf-8")
            print(f"[诊断] 作品列表为空，{len(all_urls)} 个请求已 dump 到 debug 目录。")
        return works
    finally:
        await page.close()


def _parse_work_list(captured: list[dict], limit: int) -> list[dict]:
    """解析拦截到的 API 响应。

    已验证结构：
    {
      "code": 0,
      "data": {
        "item_list": [ {...}, ... ],
        "total_count": 47
      }
    }
    """
    works: list[dict] = []
    for item in captured:
        data = item["data"]
        if not isinstance(data, dict):
            continue
        if data.get("code") != 0:
            continue
        inner = data.get("data")
        if not isinstance(inner, dict):
            continue
        item_list = inner.get("item_list")
        if not isinstance(item_list, list):
            continue
        for w in item_list:
            if isinstance(w, dict):
                works.append(_normalize_work(w))

    seen = set()
    dedup = []
    for w in works:
        if w["work_id"] in seen:
            continue
        seen.add(w["work_id"])
        dedup.append(w)
    return dedup[:limit]


def _normalize_work(w: dict) -> dict:
    """标准化单条作品数据。

    真实字段映射（来自 /api/author/short_article/list/v0/）：
    - book_id: 作品 ID
    - item_id: 内容 ID（用于前台页面）
    - multi_title: ["标题"] 数组
    - read_count: "15589" 字符串
    - word_number: 16165 整数
    - create_time: "1778838995" 字符串 timestamp
    - category: [{name: "婚姻家庭"}, ...] 数组
    - sign_status: 5 = 已签约
    - display_status: 1 = 已上架
    - is_data_show: 1 = 可查看数据
    """
    # 标题：multi_title 是数组，取第一个
    multi_title = w.get("multi_title") or []
    title = multi_title[0] if multi_title else (w.get("title") or w.get("book_name") or "")

    # 分类：category 是对象数组
    categories = w.get("category") or []
    category_names = [c.get("name", "") for c in categories if isinstance(c, dict)]

    # read_count 是字符串
    read_count_raw = w.get("read_count") or "0"
    read_count = int(read_count_raw) if isinstance(read_count_raw, str) else (read_count_raw or 0)

    # create_time 是字符串 timestamp
    create_time_raw = w.get("create_time") or "0"
    create_time = int(create_time_raw) if isinstance(create_time_raw, str) else (create_time_raw or 0)

    modify_time_raw = w.get("modify_time") or "0"
    modify_time = int(modify_time_raw) if isinstance(modify_time_raw, str) else (modify_time_raw or 0)

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
        # 以下字段需要从详情页或数据中心获取，列表接口不提供
        "collect_count": 0,
        "comment_count": 0,
        "like_count": 0,
        "reward_count": 0,
        "chapter_count": 0,
        "raw": w,
    }


async def fetch_work_detail(sess: Session, work_id: str) -> dict:
    """作品数据分析页。

    番茄小说创作者中心的数据页路径待确认，先尝试常见路径。
    拦截所有含 work_id 或 data 相关的 XHR。
    """
    captured: list[dict] = []
    all_urls: list[str] = []

    page = await sess.ctx.new_page()

    async def on_response(resp: Response) -> None:
        all_urls.append(resp.url)
        if any(k in resp.url for k in (
            "data_center", "statistics", "analysis",
            "short_article/data", "work/data", "book/data",
            work_id,
        )):
            try:
                data = await resp.json()
                if isinstance(data, dict) and data.get("code") == 0:
                    captured.append({"url": resp.url, "data": data})
            except Exception:
                pass

    page.on("response", on_response)
    try:
        # 尝试数据页面
        candidates = [
            f"https://fanqienovel.com/main/writer/short-data?book_id={work_id}",
            f"https://fanqienovel.com/main/writer/data?book_id={work_id}",
            f"https://fanqienovel.com/creator/data/work/{work_id}",
        ]
        for url in candidates:
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(5)
                if captured:
                    break
            except Exception:
                continue

        if not captured:
            dbg = debug_dir()
            dbg.mkdir(parents=True, exist_ok=True)
            (dbg / "detail_urls.txt").write_text("\n".join(all_urls), encoding="utf-8")

        return {"captured": captured, "all_urls": all_urls}
    finally:
        await page.close()


async def fetch_comments(sess: Session, work_id: str, max_pages: int = 60) -> list[dict]:
    """抓作品评论。

    番茄小说评论在前台阅读页（/page/<item_id>）或创作者中心评论管理页。
    """
    captured: list[dict] = []
    all_urls: list[str] = []

    page = await sess.ctx.new_page()

    async def on_response(resp: Response) -> None:
        all_urls.append(resp.url)
        if any(k in resp.url for k in (
            "comment", "reply", "review",
        )):
            try:
                data = await resp.json()
                if isinstance(data, dict) and data.get("code") == 0:
                    captured.append({"url": resp.url, "data": data})
            except Exception:
                pass

    page.on("response", on_response)
    try:
        # 尝试评论管理页
        comment_urls = [
            f"https://fanqienovel.com/main/writer/short-comment?book_id={work_id}",
            f"https://fanqienovel.com/main/writer/comment?book_id={work_id}",
        ]
        for url in comment_urls:
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(5)
                # 滚动加载更多评论
                for _ in range(min(max_pages, 10)):
                    await page.evaluate("window.scrollBy(0, 1000)")
                    await asyncio.sleep(1)
                if captured:
                    break
            except Exception:
                continue

        comments = _parse_comments(captured, work_id)

        if not comments:
            dbg = debug_dir()
            dbg.mkdir(parents=True, exist_ok=True)
            (dbg / "comment_urls.txt").write_text("\n".join(all_urls), encoding="utf-8")

        comments.sort(key=lambda c: c["like_count"], reverse=True)
        return comments
    finally:
        await page.close()


def _parse_comments(captured: list[dict], default_work_id: str) -> list[dict]:
    """解析评论接口响应。"""
    comments: list[dict] = []
    for item in captured:
        data = item["data"]
        if not isinstance(data, dict):
            continue
        inner = data.get("data")
        if not isinstance(inner, dict):
            # 有些接口直接在 data 层放 list
            if isinstance(data.get("comments"), list):
                for c in data["comments"]:
                    comments.append(_normalize_comment(c, default_work_id))
            continue
        # 常见结构：data.data.comment_list / data.data.list / data.data.items
        for key in ("comment_list", "list", "items", "comments", "data"):
            val = inner.get(key)
            if isinstance(val, list):
                for c in val:
                    if isinstance(c, dict):
                        comments.append(_normalize_comment(c, default_work_id))
                break

    # 去重
    seen = set()
    dedup = []
    for c in comments:
        cid = c.get("cid") or c.get("text", "")[:50]
        if cid in seen:
            continue
        seen.add(cid)
        dedup.append(c)
    return dedup


def _normalize_comment(c: dict, default_work_id: str) -> dict:
    """标准化单条评论。"""
    user = c.get("user") or c.get("user_info") or {}
    like_raw = c.get("like_count") or c.get("digg_count") or c.get("thumb_up_count") or 0
    like_count = int(like_raw) if isinstance(like_raw, str) else like_raw

    return {
        "cid": str(c.get("id") or c.get("cid") or c.get("comment_id") or ""),
        "work_id": str(c.get("book_id") or c.get("item_id") or default_work_id),
        "text": c.get("content") or c.get("text") or c.get("comment_content") or "",
        "like_count": like_count,
        "reply_count": c.get("reply_count") or c.get("reply_comment_total") or 0,
        "create_time": int(c.get("create_time") or c.get("publish_time") or 0),
        "user_name": (
            user.get("nickname") or user.get("name") or user.get("user_name")
            or c.get("user_name") or ""
        ),
    }


async def fetch_all(work_id: str) -> dict:
    """一个会话跑完作品列表 + 详细数据 + 评论。"""
    sess = await Session.open()
    try:
        print("  → 打开创作者中心，拉作品列表")
        works = await fetch_recent_works(sess, limit=50)
        work = next((w for w in works if w["work_id"] == work_id), None)
        if not work:
            print(f"       未在最近 {len(works)} 条里找到 {work_id}，用最小元数据继续。")
            work = _normalize_work({"book_id": work_id})
        else:
            print(f"       ✓ {work.get('title', '')[:40]}")

        print("  → 打开数据分析页")
        detail = await fetch_work_detail(sess, work_id)

        print("  → 抓评论")
        comments = await fetch_comments(sess, work_id, max_pages=60)
        print(f"       最终 {len(comments)} 条")

        return {"work": work, "detail": detail, "comments": comments}
    finally:
        await sess.close()


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "login":
        asyncio.run(ensure_login())
    elif len(sys.argv) > 1 and sys.argv[1] == "list":
        async def _list():
            sess = await Session.open()
            try:
                works = await fetch_recent_works(sess, limit=20)
            finally:
                await sess.close()
            for i, w in enumerate(works):
                print(f"[{i}] {w['work_id']}  阅读:{w['read_count']}  字数:{w['word_count']}  {w['title'][:40]}")
        asyncio.run(_list())
    else:
        asyncio.run(ensure_login())
