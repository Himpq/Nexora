"""配置段与默认参数的合并规则（全仓唯一定义）。

背景：agent_flow / prereq / toolbox / confusion / nightly_prep / proactive 这六处
各自抄了一份「把配置段覆盖到默认参数上」的私有函数，彼此行为还不一致
（有的不拷贝嵌套对象导致 params 与 DEFAULT_PARAMS 共享引用，有的漏掉 list 分支）。
这里把规则收敛到一处，调用方只声明「读哪个配置段 + 默认值是什么」。

覆盖规则（对所有模块一致）：

- 默认值是 dict：先浅拷贝，再把配置里的同名子项 update 进去。配置只写一个子键
  不会把其余子键清空。
- 默认值是 list：整体替换。配置语义上就是换一整张列表。
- 其余标量：整体替换。
- 配置段里出现 defaults 中不存在的键：忽略，避免拼错的键名静默生效。
"""

from __future__ import annotations

from typing import Any, Dict, Mapping


def config_section(cfg: Any, name: str) -> Mapping[str, Any]:
    """取出 cfg[name] 配置段；不是 dict 时返回空段，走纯默认值。"""
    value = cfg.get(name) if isinstance(cfg, Mapping) else None
    return value if isinstance(value, Mapping) else {}


def merged_params(defaults: Mapping[str, Any], override: Any) -> Dict[str, Any]:
    """把 override 覆盖到 defaults 上，返回全新的、与 defaults 无共享引用的字典。"""
    params: Dict[str, Any] = {}
    for key, default in defaults.items():
        if isinstance(default, dict):
            params[key] = dict(default)
        elif isinstance(default, list):
            params[key] = list(default)
        else:
            params[key] = default

    if not isinstance(override, Mapping):
        return params

    for key, value in override.items():
        if key not in params:
            continue
        if isinstance(params[key], dict) and isinstance(value, Mapping):
            params[key].update(value)
        else:
            params[key] = value
    return params


def record_agent_decision(cfg: Mapping[str, Any], username: str, decision: Mapping[str, Any], user_store: Any) -> Dict[str, Any]:
    """把一条主动决策落进用户学习记录，返回写入的那条记录。

    scheduler / confusion 归因 / prereq 检查 / toolbox 编排四处都做同一件事：
    复制决策、盖上 type 与 username、append_learning_record。返回值是补齐
    type/username 之后的记录本身——调用方要把它回填进响应体（归因扫描的
    cards_written 就是这么用的），而不是 user_store 的落盘返回值。
    """
    decision_record = dict(decision)
    decision_record["type"] = "agent_decision"
    decision_record["username"] = username
    user_store.append_learning_record(dict(cfg), username, decision_record)
    return decision_record
