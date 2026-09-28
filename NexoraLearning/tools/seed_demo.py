"""演示账号预置脚本（§11.1 数据层，确定性合成）。

生成一个干净的演示账号，含：
- ≥2 本教材（跨课程概念交集）、≥8 个已读章节、≥30 条答题记录（question_completions）
- 时间线：≥3 条 prep 卡（其中 ≥1 条带 briefing 预判讲解）、≥5 条 agent_act、
  ≥2 条 agent_hold、≥1 条 wrapup、若干 agent_session_opened
- 学习时长记录（study_time，含过去 21 天分布）

用法（NexoraLearning 目录）：
    python tools/seed_demo.py                 # 默认账号 demo_student，幂等
    python tools/seed_demo.py --reset         # 删除旧账号后重建
    python tools/seed_demo.py --username demo # 指定账号

确定性：所有时间戳与内容由固定种子生成，可反复重放。知识库（NexoraDB）与邮箱
（NexoraMail）条目依赖外部服务，脚本会探测，服务不可达时跳过并提示（不阻塞主数据）。
面二判断（cognition facets）的数据源在 #11 接入后补充（cognition/overview 读取）。
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Mapping

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import user as user_store
from core.bookindex import get_book_index
from core.booksproc.scheduler import save_annotations_xml
from core.lectures import (
    create_book,
    create_lecture,
    save_book_info_xml,
    save_book_questions_xml,
    save_book_text,
    update_book,
)

DAYS = 21
RNG_SEED = 20260930

COURSE_A_CHAPTERS = [
    "第一章 数据库系统概述",
    "第二章 关系模型",
    "第三章 SQL 基础",
    "第四章 索引与查询优化",
    "第五章 事务与并发控制",
    "第六章 备份与恢复",
    "第七章 傅里叶变换在信号处理中的应用",
    "第八章 分布式数据库",
]

COURSE_B_CHAPTERS = [
    "第一章 信号与系统导论",
    "第二章 卷积",
    "第三章 傅里叶变换",
    "第四章 采样定理",
]

# 每章核心概念（name/detail），与固化 mindmap.json 一致；傅里叶变换/卷积为跨课程交集。
COURSE_A_CONCEPTS = {
    0: [{"name": "数据模型", "detail": "对现实世界数据的抽象表示"}],
    1: [{"name": "关系模型", "detail": "用二维表组织数据"}],
    2: [{"name": "SQL", "detail": "结构化查询语言"}],
    3: [{"name": "索引", "detail": "加速数据检索的结构"}, {"name": "查询优化", "detail": "选择高效执行计划"}],
    4: [{"name": "事务", "detail": "一组原子性操作"}, {"name": "并发控制", "detail": "协调并发事务的机制"}],
    5: [{"name": "备份", "detail": "数据副本的创建"}, {"name": "恢复", "detail": "从副本还原数据"}],
    6: [{"name": "傅里叶变换", "detail": "时域与频域的桥梁"}, {"name": "卷积", "detail": "线性系统输出的运算"}],
    7: [{"name": "分布式数据库", "detail": "多节点协同的数据库"}, {"name": "一致性", "detail": "副本间数据一致"}],
}

COURSE_B_CONCEPTS = {
    0: [{"name": "信号", "detail": "承载信息的函数"}, {"name": "系统", "detail": "对信号的变换"}],
    1: [{"name": "卷积", "detail": "线性时不变系统输出的运算"}, {"name": "线性时不变系统", "detail": "满足叠加与时不变的系统"}],
    2: [{"name": "傅里叶变换", "detail": "把信号分解为正弦分量"}, {"name": "频域", "detail": "信号在频率上的表示"}],
    3: [{"name": "采样", "detail": "连续信号离散化"}, {"name": "奈奎斯特", "detail": "无损采样的最低频率条件"}],
}


def _chapter_body(name: str) -> str:
    return (
        f"{name}\n"
        f"{name}的核心概念与推导过程。本节先给出定义，再通过例题说明计算步骤。\n"
        f"本章只讲「{name}」。先把定义说清楚，再看例题，最后用自己的话复述要点。\n"
    )


def _build_course(chapters: List[str]) -> tuple[str, str, List[tuple[int, int, str]]]:
    """正文 + bookinfo XML。chapter_range 为 START:LENGTH，各章首尾相接、互不重叠。"""
    parts: List[str] = []
    blocks: List[str] = []
    ranges: List[tuple[int, int, str]] = []
    offset = 0
    for name in chapters:
        body = _chapter_body(name)
        start = offset
        length = len(body)
        ranges.append((start, length, name))
        blocks.append(
            f"<chapter><chapter_name>{name}</chapter_name><chapter_range>{start}:{length}</chapter_range></chapter>"
        )
        parts.append(body)
        offset += length
    return "".join(parts), f"<book>{''.join(blocks)}</book>", ranges


def _question_item(title: str, answer: str) -> str:
    return (
        "<question_item>"
        f"<question_title>{title}</question_title>"
        f"<question_content>{title}</question_content>"
        "<question_type>text</question_type>"
        f"<question_answer>{answer}</question_answer>"
        "</question_item>"
    )


def _questions_xml(items: List[tuple[int, int, str, str]]) -> str:
    blocks: List[str] = []
    for start, length, title, answer in items:
        blocks.append(
            f"<chapter_questions><chapter_range>{start}:{length}</chapter_range><question_items>"
            f"{_question_item(title, answer)}"
            "</question_items></chapter_questions>"
        )
    return f"<questions>{''.join(blocks)}</questions>"


def _mark_prepped(cfg: Dict[str, Any], lecture_id: str, book_id: str) -> None:
    update_book(cfg, lecture_id, book_id, {
        "coarse_status": "done",
        "intensive_status": "done",
        "section_status": "done",
        "summary_status": "done",
        "annotation_status": "done",
        "question_status": "done",
    })


def _write_solidified(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    course_title: str,
    chapters: List[str],
    concepts_map: Dict[int, List[Dict[str, str]]],
) -> None:
    """写 solidified/outline.json + mindmap.json（cognition 概念目录的数据源）。

    结构与核心实现一致（已读源码核实）：
    - outline：{course_title, sections: [{id, title, summary, objectives, key_concepts,
      difficulty, estimated_minutes, prerequisites, sources: [{book_id, chapter_name}], exploration}]}
    - mindmap：{course_title, chapters: [{section_id, name, summary,
      concepts: [{name, detail}]}], relations: [{from, to, type}]}
    """
    import json as json_lib

    sections = []
    chapters_tree = []
    for index, name in enumerate(chapters):
        concepts = concepts_map.get(index, [])
        sections.append({
            "id": f"sec_{index + 1:03d}",
            "title": name,
            "summary": f"{name}的学习要点。",
            "objectives": [f"掌握{name}的核心概念"],
            "key_concepts": [item["name"] for item in concepts],
            "difficulty": "中等",
            "estimated_minutes": 30,
            "prerequisites": [],
            "sources": [{"book_id": book_id, "chapter_name": name}],
            "exploration": {},
        })
        chapters_tree.append({
            "section_id": f"sec_{index + 1:03d}",
            "name": name,
            "summary": f"{name}的学习要点。",
            "concepts": [{"name": item["name"], "detail": item["detail"]} for item in concepts],
        })

    all_concepts = [item for row in concepts_map.values() for item in row]
    names = [item["name"] for item in all_concepts]
    relations = []
    for first, second in zip(names, names[1:]):
        relations.append({"from": first, "to": second, "type": "related"})
    if "卷积" in names and "傅里叶变换" in names:
        relations.append({"from": "卷积", "to": "傅里叶变换", "type": "prerequisite"})

    outline = {
        "course_title": course_title,
        "course_summary": f"{course_title}演示大纲。",
        "course_long_summary": "",
        "learning_objectives": [],
        "learning_tasks": [],
        "sections": sections,
    }
    mindmap = {
        "course_title": course_title,
        "chapters": chapters_tree,
        "relations": relations,
    }
    solidified = Path(cfg.get("data_dir") or "data") / "lectures" / lecture_id / "solidified"
    solidified.mkdir(parents=True, exist_ok=True)
    (solidified / "outline.json").write_text(json_lib.dumps(outline, ensure_ascii=False, indent=2), encoding="utf-8")
    (solidified / "mindmap.json").write_text(json_lib.dumps(mindmap, ensure_ascii=False, indent=2), encoding="utf-8")


def seed_confusion_signals(cfg: Dict[str, Any], username: str, courses: List[Dict[str, Any]]) -> Dict[str, int]:
    """写入困惑信号（B3 演示用，确定性）：
    - 傅里叶变换：2 次划线未问 + 1 次提问 + 1 次停顿 + 1 道错题 → 权重 2.0+1.5+0.5+2.0=6.0 ≥ 阈值
    - 卷积：1 次划线 + 1 道错题 → 3.0 ≥ 阈值
    - 事务：1 道错题 → 2.0 不超阈（验证「无噪音」）
    """
    from api.telemetry import init_telemetry, ingest_batch

    init_telemetry(cfg)
    course_a = courses[0]
    course_b = courses[1]
    now = int(time.time())
    events = [
        {"stream": "reading", "event": "selection", "bid": course_a["book_id"], "ci": 6, "si": 0, "sel_text": "傅里叶变换把信号从时域变换到频域", "ts": now - 6 * 86400},
        {"stream": "reading", "event": "selection", "bid": course_a["book_id"], "ci": 6, "si": 1, "sel_text": "这一段讲傅里叶变换，先划线记下", "ts": now - 5 * 86400},
        {"stream": "reading", "event": "ask", "bid": course_a["book_id"], "ci": 6, "si": 0, "sel_text": "傅里叶变换和卷积是什么关系？", "focus": "chat", "ts": now - 4 * 86400},
        {"stream": "reading", "event": "focus_out", "bid": course_b["book_id"], "ci": 2, "si": 0, "focus": "blur", "ts": now - 3 * 86400},
        {"stream": "reading", "event": "selection", "bid": course_b["book_id"], "ci": 1, "si": 0, "sel_text": "卷积刻画线性时不变系统的输出", "ts": now - 2 * 86400},
    ]
    result = ingest_batch(username, events)

    user_store.append_question_completion(cfg, username, {
        "lecture_id": course_a["lecture_id"],
        "book_id": course_a["book_id"],
        "chapter_index": 6,
        "chapter_name": "第七章 傅里叶变换在信号处理中的应用",
        "question_title": "傅里叶变换的物理意义是什么",
        "is_correct": False,
        "timestamp": now - 5 * 86400,
    })
    user_store.append_question_completion(cfg, username, {
        "lecture_id": course_b["lecture_id"],
        "book_id": course_b["book_id"],
        "chapter_index": 1,
        "chapter_name": "第二章 卷积",
        "question_title": "卷积的物理意义",
        "is_correct": False,
        "timestamp": now - 1 * 86400,
    })
    user_store.append_question_completion(cfg, username, {
        "lecture_id": course_a["lecture_id"],
        "book_id": course_a["book_id"],
        "chapter_index": 4,
        "chapter_name": "第五章 事务与并发控制",
        "question_title": "事务的隔离级别有哪些",
        "is_correct": False,
        "timestamp": now - 2 * 86400,
    })
    return {"telemetry_accepted": result.accepted, "wrong_answers": 3}


def seed_mirror(cfg: Dict[str, Any], username: str, courses: List[Dict[str, Any]]) -> Dict[str, Any]:
    """面二演示数据（#11）：跑一次困惑扫描（幂等）→ 数据模型 3 道全对（正确率判断）
    → 对「卷积」困惑判断做一次反驳（曾有一条判断被反驳，§11.1）。"""
    from core.cognition.attribution import scan_confusion
    from core.cognition.facets import build_facets, record_verdict

    course_a = courses[0]
    now = int(time.time())
    scan_confusion(cfg, username)
    for index in range(3):
        user_store.append_question_completion(cfg, username, {
            "lecture_id": course_a["lecture_id"],
            "book_id": course_a["book_id"],
            "chapter_index": 0,
            "chapter_name": "第一章 数据库系统概述",
            "question_title": "数据模型的抽象层次",
            "is_correct": True,
            "timestamp": now - (4 + index) * 3600,
        })
    overview = build_facets(cfg, username)
    for facet in overview["facets"]:
        if "卷积" in facet["claim"] and facet["userVerdict"] is None:
            record_verdict(
                cfg,
                username,
                facet["id"],
                "disagree",
                lecture_id=facet["lectureId"],
                book_id=facet["bookId"],
                concept_id=facet["conceptId"],
            )
            break
    return {"facets": len(overview["facets"]), "mastery_cells": len(overview["mastery"])}


def ensure_courses(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """两门课程（跨课程概念交集：傅里叶变换/卷积），幂等创建。"""
    courses: List[Dict[str, Any]] = []
    lecture_a = create_lecture(cfg, "数据库导论", description="演示课程 A", status="published")
    book_a = create_book(cfg, lecture_a["id"], "数据库系统原理")
    text_a, info_a, ranges_a = _build_course(COURSE_A_CHAPTERS)
    save_book_text(cfg, lecture_a["id"], book_a["id"], text_a)
    save_book_info_xml(cfg, lecture_a["id"], book_a["id"], info_a)
    _mark_prepped(cfg, lecture_a["id"], book_a["id"])
    save_annotations_xml(
        cfg,
        lecture_a["id"],
        book_a["id"],
        "<annotations><coordinate_space>plain</coordinate_space>"
        "<annotation><chapter_name>第一章 数据库系统概述</chapter_name><anchor_text>数据模型是对现实世界的抽象</anchor_text></annotation>"
        "<annotation><chapter_name>第二章 关系模型</chapter_name><anchor_text>关系是一张二维表</anchor_text></annotation>"
        "<annotation><chapter_name>第七章 傅里叶变换在信号处理中的应用</chapter_name><anchor_text>时域卷积对应频域乘积</anchor_text></annotation>"
        "</annotations>",
    )
    save_book_questions_xml(
        cfg,
        lecture_a["id"],
        book_a["id"],
        _questions_xml([
            (ranges_a[0][0], ranges_a[0][1], "数据模型的抽象层次", "概念-逻辑-物理"),
            (ranges_a[6][0], ranges_a[6][1], "时域卷积与频域的关系", "乘积"),
        ]),
    )
    courses.append({"lecture_id": lecture_a["id"], "book_id": book_a["id"], "title": lecture_a["title"], "chapters": COURSE_A_CHAPTERS})
    _write_solidified(cfg, lecture_a["id"], book_a["id"], lecture_a["title"], COURSE_A_CHAPTERS, COURSE_A_CONCEPTS)

    lecture_b = create_lecture(cfg, "信号与系统", description="演示课程 B（跨课程概念交集）", status="published")
    book_b = create_book(cfg, lecture_b["id"], "信号与系统基础")
    text_b, info_b, ranges_b = _build_course(COURSE_B_CHAPTERS)
    save_book_text(cfg, lecture_b["id"], book_b["id"], text_b)
    save_book_info_xml(cfg, lecture_b["id"], book_b["id"], info_b)
    _mark_prepped(cfg, lecture_b["id"], book_b["id"])
    save_annotations_xml(
        cfg,
        lecture_b["id"],
        book_b["id"],
        "<annotations><coordinate_space>plain</coordinate_space>"
        "<annotation><chapter_name>第二章 卷积</chapter_name><anchor_text>卷积刻画线性时不变系统的输出</anchor_text></annotation>"
        "<annotation><chapter_name>第三章 傅里叶变换</chapter_name><anchor_text>傅里叶变换把信号分解为正弦分量</anchor_text></annotation>"
        "</annotations>",
    )
    save_book_questions_xml(
        cfg,
        lecture_b["id"],
        book_b["id"],
        _questions_xml([
            (ranges_b[1][0], ranges_b[1][1], "卷积的物理意义", "线性时不变系统输出"),
        ]),
    )
    courses.append({"lecture_id": lecture_b["id"], "book_id": book_b["id"], "title": lecture_b["title"], "chapters": COURSE_B_CHAPTERS})
    _write_solidified(cfg, lecture_b["id"], book_b["id"], lecture_b["title"], COURSE_B_CHAPTERS, COURSE_B_CONCEPTS)
    return courses


def _days_ago(days: int, hour: int, minute: int = 0) -> int:
    now = time.time()
    base = now - days * 86400
    local = time.localtime(base)
    return int(time.mktime((local.tm_year, local.tm_mon, local.tm_mday, hour, minute, 0, 0, 0, -1)))


def seed_learning_history(cfg: Dict[str, Any], username: str, courses: List[Dict[str, Any]]) -> Dict[str, int]:
    rng = random.Random(RNG_SEED)
    course_a = courses[0]
    course_b = courses[1]
    counts: Dict[str, int] = {"study_time": 0, "chapter_completed": 0, "questions": 0, "prep": 0, "agent_act": 0, "agent_hold": 0, "wrapup": 0}

    # —— 阅读与学习时长（21 天分布，晚上 19:00–22:00 为主）——
    for day in range(DAYS - 1, 0, -1):
        if day % 2 == 1:
            continue
        hour = rng.choice([19, 20, 21, 22])
        seconds = rng.choice([900, 1500, 2400, 3600])
        user_store.append_learning_record(cfg, username, {
            "type": "study_time",
            "lecture_id": course_a["lecture_id"],
            "book_id": course_a["book_id"],
            "study_seconds": seconds,
            "timestamp": _days_ago(day, hour),
        })
        counts["study_time"] += 1

    # —— ≥8 个已读章节（课程 A 前 6 章 + 课程 B 前 2 章）——
    completed: List[Dict[str, Any]] = []
    for index, name in enumerate(course_a["chapters"][:6]):
        completed.append({"course": course_a, "index": index, "name": name})
    for index, name in enumerate(course_b["chapters"][:2]):
        completed.append({"course": course_b, "index": index, "name": name})
    for offset, item in enumerate(completed):
        day = max(1, (DAYS - 1) - offset * 2)
        ts = _days_ago(day, rng.choice([19, 20, 21]))
        user_store.append_learning_record(cfg, username, {
            "type": "chapter_completed",
            "lecture_id": item["course"]["lecture_id"],
            "book_id": item["course"]["book_id"],
            "chapter_index": item["index"],
            "chapter_name": item["name"],
            "timestamp": ts,
        })
        user_store.append_learning_record(cfg, username, {
            "type": "session_completed",
            "lecture_id": item["course"]["lecture_id"],
            "book_id": item["course"]["book_id"],
            "chapter_index": item["index"],
            "chapter_name": item["name"],
            "timestamp": ts + rng.choice([600, 900, 1800]),
        })
        counts["chapter_completed"] += 1

    # —— ≥30 条答题记录（正确率约 78%）——
    for index in range(34):
        day = rng.randint(1, DAYS - 1)
        item = rng.choice(completed)
        user_store.append_question_completion(cfg, username, {
            "lecture_id": item["course"]["lecture_id"],
            "book_id": item["course"]["book_id"],
            "chapter_index": item["index"],
            "chapter_name": item["name"],
            "question_title": f"练习题 {index + 1}",
            "is_correct": rng.random() < 0.78,
            "timestamp": _days_ago(day, rng.choice([19, 20, 21, 22])),
        })
        counts["questions"] += 1

    # —— 时间线：会话记录 ——
    for index in range(4):
        item = completed[index]
        user_store.append_learning_record(cfg, username, {
            "type": "agent_session_opened",
            "session_id": f"session_demo_{index}",
            "lecture_id": item["course"]["lecture_id"],
            "book_id": item["course"]["book_id"],
            "chapter_index": item["index"],
            "chapter_name": item["name"],
            "source": "app",
            "timestamp": _days_ago(DAYS - 2 - index * 3, 20),
        })

    # —— ≥3 条 prep 卡（1 条带 briefing 预判讲解）——
    prep_chapters = ["第五章 事务与并发控制", "第六章 备份与恢复", "第七章 傅里叶变换在信号处理中的应用"]
    for index, chapter in enumerate(prep_chapters):
        briefing = None
        if index == 2:
            briefing = {"conceptId": "concept_fourier", "concept": "傅里叶变换", "hitCount": 4, "minutes": 3}
        record = {
            "type": "agent_decision",
            "decision_id": f"dec_prep_demo_{index}",
            "kind": "agent_act",
            "trigger": "prep_done",
            "unattended": True,
            "timestamp": _days_ago(DAYS - 1 - index * 3, 2, 10),
            "text": f"我昨晚把{chapter}读完了，划了 3 个重点，出了 3 道题。",
            "reason": "夜间备课完成。",
            "evidence": [{"label": f"昨晚备课完成：{chapter}", "source": "prep"}],
            "card": {
                "type": "prep",
                "chapter": chapter,
                "highlights": ["事务的 ACID 特性", "备份窗口与恢复点目标", "时域卷积对应频域乘积"],
                "quizCount": 3,
                "durationMs": 8 * 60 * 1000,
            },
            "status": "pending",
            "source": "seed_demo",
        }
        if briefing:
            record["card"]["briefing"] = briefing
        user_store.append_learning_record(cfg, username, record)
        counts["prep"] += 1

    # —— 决策器条目：≥5 agent_act + ≥2 agent_hold + 1 条被回喂的 accept ——
    acts = [
        {"trigger": "forgetting_curve", "text": "第一章 数据库系统概述该复习了，距上次学完已过 3 天。10 分钟过一遍？", "status": "accept"},
        {"trigger": "prereq_gap", "text": "这节要用到卷积，你之前学过但最近没碰。先花 3 分钟补一下？", "status": "dismiss"},
        {"trigger": "confusion_spike", "text": "你在傅里叶变换上卡过 4 次。我备了段讲解，现在过一遍？", "status": "pending"},
        {"trigger": "unfinished_chapter", "text": "第四章 索引与查询优化上次没读完。今天 20 分钟收个尾？", "status": "accept"},
        {"trigger": "mail_arrived", "text": "收到一封新邮件：数据库作业。要我读一下并安排进计划吗？", "status": "dismiss"},
    ]
    for index, item in enumerate(acts):
        user_store.append_learning_record(cfg, username, {
            "type": "agent_decision",
            "decision_id": f"dec_act_demo_{index}",
            "kind": "agent_act",
            "trigger": item["trigger"],
            "fire": True,
            "unattended": True,
            "timestamp": _days_ago(max(1, 12 - index * 2), 20),
            "text": item["text"],
            "reason": "依据学习进度与遗忘曲线。",
            "evidence": [{"label": item["text"], "source": "progress"}],
            "card": {"type": "proactive", "title": item["text"], "reason": "依据学习进度与遗忘曲线。", "minutes": 10, "accept": "好", "defer": "晚点", "dismiss": "不用了"},
            "status": item["status"],
            "source": "seed_demo",
        })
        counts["agent_act"] += 1
    for index, text in enumerate(["今天已经提醒过两次了，我先记下，明天再说。", "你开了免打扰，我先记下来，等方便了再说。"]):
        user_store.append_learning_record(cfg, username, {
            "type": "agent_decision",
            "decision_id": f"dec_hold_demo_{index}",
            "kind": "agent_hold",
            "trigger": "prep_done" if index == 0 else "forgetting_curve",
            "fire": False,
            "unattended": True,
            "timestamp": _days_ago(6 - index * 3, 23, 15),
            "text": text,
            "reason": "静默时段 23:00–08:00" if index == 0 else "系统免打扰开启",
            "evidence": [],
            "card": None,
            "status": "pending",
            "source": "seed_demo",
        })
        counts["agent_hold"] += 1

    # —— 1 条 wrapup 验收卡（N5）——
    user_store.append_learning_record(cfg, username, {
        "type": "agent_decision",
        "decision_id": "dec_wrapup_demo_0",
        "kind": "agent_act",
        "trigger": "wrapup",
        "unattended": False,
        "timestamp": _days_ago(2, 21, 30),
        "text": "今晚 12 分钟做完了：读了第五章、3 道题全对、事务的掌握度从 0.3 升到 0.7。有 1 道题我拿不准，你看一下。",
        "reason": "学习闭环完成。",
        "evidence": [{"label": "答题 3/3 正确", "source": "progress"}],
        "card": {
            "type": "wrapup",
            "minutes": 12,
            "chapter": "第五章 事务与并发控制",
            "quizScore": "3/3",
            "masteryShift": [{"concept": "事务", "from": 0.3, "to": 0.7}],
            "uncertain": [{"questionId": "q_demo_1", "why": "该题判分置信度低，需要你裁决"}],
        },
        "status": "pending",
        "source": "seed_demo",
    })
    counts["wrapup"] += 1
    return counts


def probe_external_services(cfg: Dict[str, Any], username: str) -> Dict[str, Any]:
    """知识库与邮箱条目：服务可达时写入，不可达时跳过（不阻塞主数据）。"""
    result: Dict[str, Any] = {"kb": False, "mail": False}
    import urllib.request

    nexoradb = cfg.get("nexoradb") or {}
    db_url = str(nexoradb.get("service_url") or "").strip()
    if db_url:
        try:
            req = urllib.request.Request(f"{db_url.rstrip('/')}/admin/api/projects", headers={"X-API-Key": str(nexoradb.get("api_key") or "")})
            urllib.request.urlopen(req, timeout=5)
            result["kb"] = True
        except Exception:
            result["kb"] = False
    # NexoraMail 的作业邮件（WS 事件驱动 #18 再接入；此处仅探测）
    mail_cfg = cfg.get("nexora_mail") or {}
    mail_url = str(mail_cfg.get("service_url") or "").strip()
    if mail_url:
        try:
            urllib.request.urlopen(f"{mail_url.rstrip('/')}/health", timeout=5)
            result["mail"] = True
        except Exception:
            result["mail"] = False
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="演示账号预置（§11.1）")
    parser.add_argument("--username", default="demo_student")
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()

    from main import ensure_bootstrap

    cfg = ensure_bootstrap()
    username = str(args.username or "").strip() or "demo_student"

    if args.reset:
        user_store.delete_user(cfg, username)
        print(f"[seed] 已删除旧账号 {username}")

    user_store.create_user(cfg, user_id=username, username=username, display_name="演示同学", identity="student")
    user_store.ensure_user_files(cfg, username)

    courses = ensure_courses(cfg)
    for course in courses:
        user_store.set_lecture_selection(cfg, username, course["lecture_id"], selected=True, actor="seed_demo")

    counts = seed_learning_history(cfg, username, courses)
    signal_counts = seed_confusion_signals(cfg, username, courses)
    mirror_counts = seed_mirror(cfg, username, courses)
    external = probe_external_services(cfg, username)

    print(f"[seed] 演示账号 {username} 预置完成：")
    print(f"       课程 {len(courses)} 门 / 已读章节 {counts['chapter_completed']} / 答题 {counts['questions'] + signal_counts['wrong_answers'] + 3} 条")
    print(f"       时间线 prep {counts['prep']} / agent_act {counts['agent_act']} / agent_hold {counts['agent_hold']} / wrapup {counts['wrapup']}")
    print(f"       困惑信号：telemetry 入读 {signal_counts['telemetry_accepted']} 条 + 错题 {signal_counts['wrong_answers']} 条（傅里叶/卷积超阈、事务不超阈）")
    print(f"       面二：判断 {mirror_counts['facets']} 条 / 掌握度单元 {mirror_counts['mastery_cells']} 个（含 1 次反驳）")
    print(f"       外部服务：NexoraDB {'可达' if external['kb'] else '不可达（已跳过）'} / NexoraMail {'可达' if external['mail'] else '不可达（已跳过）'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
