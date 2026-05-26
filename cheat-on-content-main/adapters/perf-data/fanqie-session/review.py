"""发完作品后跑一次：抓评论/数据 → 生成 Markdown 报告。

用法：
    python review.py                          # 交互式选作品
    python review.py login                    # 仅登录（首次）
    python review.py work <work_id> [script.txt]   # 直接指定作品
    python review.py list                     # 列最近作品
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import crawler
import renderer
from paths import videos_dir


def _prompt(msg: str) -> str:
    try:
        return input(msg).strip()
    except EOFError:
        return ""


def _pick_work(works: list[dict]) -> dict | None:
    if not works:
        print("未抓到作品列表。请确认创作者中心已登录，或页面结构已变，需要更新 crawler。")
        return None
    print("\n最近作品：")
    for i, w in enumerate(works):
        t = renderer._fmt_time(w.get("create_time", 0))
        title = (w.get("title") or "").replace("\n", " ")[:40]
        print(f"  [{i}] {t} | 阅读 {renderer._fmt_num(w.get('read_count'))} | {title}")
    choice = _prompt("\n选择序号（回车取消）：")
    if not choice.isdigit():
        return None
    idx = int(choice)
    if 0 <= idx < len(works):
        return works[idx]
    return None


async def run() -> None:
    active_videos_dir = videos_dir()
    active_videos_dir.mkdir(parents=True, exist_ok=True)

    print("[选作品] 打开创作者中心拉列表……")
    sess = await crawler.Session.open()
    try:
        works = await crawler.fetch_recent_works(sess, limit=10)
    finally:
        await sess.close()
    work = _pick_work(works)
    if not work:
        print("已取消。")
        return

    script_raw = _prompt("把稿子 txt 拖进来（或回车跳过）：")
    script_path: str | None = None
    if script_raw.strip():
        p = Path(script_raw.strip().strip("'").strip('"').replace("\\ ", " ")).expanduser()
        if p.is_file():
            script_path = str(p)
        else:
            print(f"[警告] 找不到 {p}，稿子留空。")

    await run_with_id(work["work_id"], script_path)


async def run_with_id(work_id: str, script_path: str | None) -> None:
    active_videos_dir = videos_dir()
    active_videos_dir.mkdir(parents=True, exist_ok=True)

    script = ""
    if script_path:
        p = Path(script_path).expanduser()
        if p.is_file():
            script = p.read_text(encoding="utf-8", errors="ignore")
            print(f"稿子：{p.name}（{len(script)} 字符）")
        else:
            print(f"[警告] 找不到稿子 {p}")

    print(f"[抓取] 作品 {work_id}")
    result = await crawler.fetch_all(work_id)
    work = result["work"]
    detail = result["detail"]
    comments = result["comments"]

    out_dir = renderer.output_dir_for(work, active_videos_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if script:
        (out_dir / "script.txt").write_text(script, encoding="utf-8")
    md = renderer.render_report(work, script, comments, detail.get("captured"))
    report = out_dir / "report.md"
    report.write_text(md, encoding="utf-8")
    print(f"\n✓ {report}")


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "login":
        asyncio.run(crawler.ensure_login())
        return
    if len(sys.argv) > 1 and sys.argv[1] == "work":
        work_id = sys.argv[2]
        script_path = sys.argv[3] if len(sys.argv) > 3 else None
        asyncio.run(run_with_id(work_id, script_path))
        return
    if len(sys.argv) > 1 and sys.argv[1] == "list":
        async def _list() -> None:
            sess = await crawler.Session.open()
            try:
                works = await crawler.fetch_recent_works(sess, limit=20)
            finally:
                await sess.close()
            for i, w in enumerate(works):
                t = renderer._fmt_time(w.get("create_time", 0))
                title = (w.get("title") or "").replace("\n", " ")[:50]
                print(f"[{i}] {w['work_id']}  {t}  阅读{renderer._fmt_num(w.get('read_count'))}  {title}")
        asyncio.run(_list())
        return
    asyncio.run(run())


if __name__ == "__main__":
    main()
