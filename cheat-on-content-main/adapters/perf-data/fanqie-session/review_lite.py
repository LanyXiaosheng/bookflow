"""轻量版 CLI 入口（纯 HTTP，无需 Playwright）。

用法：
    python review_lite.py list                     # 列最近作品
    python review_lite.py all                      # 列全量作品（含统计）
    python review_lite.py work <work_id> [script]  # 抓特定作品生成 report
    python review_lite.py account                  # 账号总览
"""
from __future__ import annotations

import sys
import time
import datetime as dt
from pathlib import Path

import crawler_lite
import renderer
from paths import videos_dir

def cmd_list() -> None:
    works = crawler_lite.fetch_all_works()
    print(f"共 {len(works)} 篇作品：\n")
    for i, w in enumerate(works):
        print(
            f"[{i:2d}] {w['work_id']}  "
            f"阅读:{w['read_count']:>6}  "
            f"字数:{w['word_count']:>6}  "
            f"{w['title'][:40]}"
        )

def cmd_account() -> None:
    stats = crawler_lite.fetch_account_stats()
    if not stats:
        print("获取账号数据失败")
        return
    read = crawler_lite._safe_int(stats.get("read_count"))
    show = crawler_lite._safe_int(stats.get("show_count"))
    cr = stats.get("click_rate") or "0"
    print("=== 账号总览 ===")
    print(f"  总曝光：{show:,}")
    print(f"  总阅读：{read:,}")
    print(f"  点击率：{float(cr)*100:.1f}%")
    print(f"  总收藏：{stats.get('shelf_count', 0)}")
    print(f"  总评论：{stats.get('comment_count', 0)}")
    print(f"  总点赞：{stats.get('digg_count', 0)}")
    print(f"  今日增阅读：+{stats.get('read_count_increase', 0)}")
    print(f"  今日增曝光：+{stats.get('show_count_increase', 0)}")
    pay_rate = stats.get("douyin_pay_rate") or "0"
    if pay_rate != "0":
        print(f"  付费率：{float(pay_rate)*100:.1f}%")
    pop = stats.get("douyin_read_popularity_score") or "0"
    if pop != "0":
        print(f"  阅读热度分：{pop}")

def cmd_work(work_id: str, script_path: str | None = None) -> None:
    active_videos_dir = videos_dir()
    active_videos_dir.mkdir(parents=True, exist_ok=True)

    cookie = crawler_lite._load_cookies()

    script = ""
    if script_path:
        p = Path(script_path).expanduser()
        if p.is_file():
            script = p.read_text(encoding="utf-8", errors="ignore")
            print(f"稿子：{p.name}（{len(script)} 字符）")
        else:
            print(f"[警告] 找不到稿子 {p}")

    print(f"[抓取] 作品 {work_id}（lite 模式）")

    # 1. 拉作品列表找元数据
    works = crawler_lite.fetch_all_works(cookie)
    work = next((w for w in works if w["work_id"] == work_id), None)
    if not work:
        work = next((w for w in works if w.get("item_id") == work_id), None)
    if not work:
        print(f"[警告] 未在 {len(works)} 篇里找到 {work_id}，用最小元数据继续。")
        work = crawler_lite._normalize_work({"book_id": work_id})
    else:
        print(f"  ✓ {work['title'][:40]}  阅读:{work['read_count']}")

    # 2. 拉统计数据
    stats = None
    if work.get("is_data_show"):
        print("  → 拉统计数据...")
        stats = crawler_lite.fetch_work_stats(work_id, cookie)
        if stats:
            work["digg_count"] = stats.get("digg_count", 0)
            work["comment_count"] = stats.get("comment_count", 0)
            work["collect_count"] = stats.get("shelf_count", 0)
            work["show_count"] = stats.get("show_count", 0)
            work["click_rate"] = stats.get("click_rate", "")
            print(f"    曝光:{stats.get('show_count',0):,}  点击率:{float(stats.get('click_rate') or 0)*100:.1f}%  赞:{stats.get('digg_count',0)}  评:{stats.get('comment_count',0)}  藏:{stats.get('shelf_count',0)}")

    # 3. 拉日增长数据（最近 7 天）
    daily_data = []
    if work.get("is_data_show") and work.get("create_time"):
        print("  → 拉日增长数据...")
        daily_data = _fetch_daily_range(work_id, work["create_time"], cookie)
        if daily_data:
            print(f"    获取 {len(daily_data)} 天数据")

    # 4. 渲染 report
    out_dir = renderer.output_dir_for(work, active_videos_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if script:
        (out_dir / "script.txt").write_text(script, encoding="utf-8")

    md = renderer.render_report(
        work, script, comments=[],
        detail_captured=None,
        stats=stats,
        daily_data=daily_data,
    )
    report = out_dir / "report.md"
    report.write_text(md, encoding="utf-8")
    print(f"\n✓ {report}")

def _fetch_daily_range(book_id: str, create_ts: int, cookie: str, max_days: int = 14) -> list[dict]:
    """拉发布后每天的数据。"""
    results = []
    today = dt.date.today()
    pub_date = dt.date.fromtimestamp(create_ts)

    # 从发布日到今天（最多 max_days 天）
    days_since = (today - pub_date).days
    num_days = min(days_since, max_days)

    for i in range(num_days):
        target_date = pub_date + dt.timedelta(days=i)
        ts = int(dt.datetime.combine(target_date, dt.time.min).timestamp())
        data = crawler_lite.fetch_work_daily(book_id, ts, cookie)
        if data and data.get("read_count", 0) > 0:
            data["date"] = target_date.strftime("%m-%d")
            data["day_index"] = i
            results.append(data)
        time.sleep(0.3)

    return results

def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd in ("list", "all"):
        cmd_list()
    elif cmd == "account":
        cmd_account()
    elif cmd == "work":
        if len(sys.argv) < 3:
            print("Usage: python review_lite.py work <work_id> [script_path]")
            sys.exit(1)
        work_id = sys.argv[2]
        script_path = sys.argv[3] if len(sys.argv) > 3 else None
        cmd_work(work_id, script_path)
    else:
        print(f"未知命令：{cmd}")
        print(__doc__)
        sys.exit(1)

if __name__ == "__main__":
    main()
