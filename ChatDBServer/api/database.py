import os
import json
import time
import re
import threading
import hashlib

# 全局文件锁，防止多用户并发写入 user.json 导致数据“串”或丢失
_global_file_lock = threading.Lock()
# 用户目录锁，防止同一用户的 database.json 并发写入冲突
_user_locks = {}
_user_locks_lock = threading.Lock()

def get_user_lock(username):
    with _user_locks_lock:
        if username not in _user_locks:
            _user_locks[username] = threading.Lock()
        return _user_locks[username]

# 知识库

SHORT_TIME = 0
BASIS = 1
USER_PROFILE_MAX_CHARS = 400
USER_PROFILE_DEFAULT_TEMPLATE = "用户权限:{user_permission}，还没有写入其他信息。"


class User:
    def __init__(self, username):
        self.path = f"./data/users/{username}/"
        self.user = username
        os.makedirs(self.path, exist_ok=True)
        self._ensure_knowledge_graph()

    def _profile_memory_file(self):
        return os.path.join(self.path, "profile", "user_profile.txt")

    def _default_user_profile_text(self, user_permission=""):
        perm = str(user_permission or "").strip() or "member"
        return USER_PROFILE_DEFAULT_TEMPLATE.replace("{user_permission}", perm)

    def _normalize_user_profile_text(self, text, user_permission="", max_chars=USER_PROFILE_MAX_CHARS):
        try:
            max_len = int(max_chars or USER_PROFILE_MAX_CHARS)
        except Exception:
            max_len = USER_PROFILE_MAX_CHARS
        max_len = max(60, min(max_len, 2000))

        normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if not normalized:
            normalized = self._default_user_profile_text(user_permission=user_permission)
        if len(normalized) > max_len:
            normalized = normalized[:max_len].rstrip()
        return normalized

    def get_user_profile_memory(self, user_permission="", max_chars=USER_PROFILE_MAX_CHARS):
        lock = get_user_lock(self.user)
        with lock:
            file_path = self._profile_memory_file()
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            raw = ""
            if os.path.exists(file_path):
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        raw = str(f.read() or "")
                except Exception:
                    raw = ""
            normalized = self._normalize_user_profile_text(
                raw,
                user_permission=user_permission,
                max_chars=max_chars
            )
            if (not os.path.exists(file_path)) or (normalized != raw.strip()):
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(normalized)
            return normalized

    def set_user_profile_memory(self, profile_text, user_permission="", max_chars=USER_PROFILE_MAX_CHARS):
        normalized = self._normalize_user_profile_text(
            profile_text,
            user_permission=user_permission,
            max_chars=max_chars
        )
        lock = get_user_lock(self.user)
        with lock:
            file_path = self._profile_memory_file()
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(normalized)
        return normalized

    def _ensure_knowledge_graph(self):
        """确保知识图谱文件存在"""
        graph_file = self.path + "knowledge_graph.json"
        if not os.path.exists(graph_file):
            initial_graph = {
                "categories": {
                    "未分类": {
                        "name": "未分类",
                        "color": "#9ca3af",
                        "knowledge_ids": [],
                        "position": {"x": 0, "y": 0}
                    }
                },
                "connections": [],
                "category_order": ["未分类"]
            }
            with open(graph_file, "w", encoding="utf-8") as f:
                json.dump(initial_graph, f, indent=4, ensure_ascii=False)

    def _build_basis_id(self, title, meta):
        m = meta if isinstance(meta, dict) else {}
        seed = "|".join([
            str(title or "").strip(),
            str(m.get("src") or "").strip(),
            str(m.get("created_at") or ""),
            str(m.get("share_id") or "").strip(),
        ])
        digest = hashlib.md5(seed.encode("utf-8")).hexdigest()[:12]
        return f"kb_{digest}"

    def _ensure_basis_ids_in_db(self, db):
        changed = False
        data_basis = db.get("data_basis", {})
        if not isinstance(data_basis, dict):
            return False
        for title, meta in data_basis.items():
            if not isinstance(meta, dict):
                continue
            basis_id = str(meta.get("basis_id") or "").strip()
            if basis_id:
                continue
            meta["basis_id"] = self._build_basis_id(title, meta)
            changed = True
        return changed

    def _char_to_line_col(self, content, pos):
        idx = max(0, min(int(pos or 0), len(content)))
        line = content.count("\n", 0, idx) + 1
        last_nl = content.rfind("\n", 0, idx)
        col = idx + 1 if last_nl < 0 else (idx - last_nl)
        return line, col

    def _resolve_basis_title_and_meta(self, db, title=None, basis_id=None):
        data_basis = db.get("data_basis", {})
        if not isinstance(data_basis, dict):
            return None, None, "data_basis missing"

        t = str(title or "").strip()
        bid = str(basis_id or "").strip()

        if t:
            meta = data_basis.get(t)
            if isinstance(meta, dict):
                if not str(meta.get("basis_id") or "").strip():
                    meta["basis_id"] = self._build_basis_id(t, meta)
                return t, meta, ""
            return None, None, f"Title not found: {t}"

        if bid:
            for k, meta in data_basis.items():
                if not isinstance(meta, dict):
                    continue
                now_bid = str(meta.get("basis_id") or "").strip()
                if not now_bid:
                    now_bid = self._build_basis_id(k, meta)
                    meta["basis_id"] = now_bid
                if now_bid == bid:
                    return k, meta, ""
            return None, None, f"basis_id not found: {bid}"

        return None, None, "title or basis_id is required"

    def getPassword(self):
        with open("./data/user.json", "r", encoding="utf-8") as f:
            users = json.load(f)
        return users[self.user]["password"]
    
    def getKnowledgeList(self, _type=SHORT_TIME):
        lock = get_user_lock(self.user)
        with lock:
            if not os.path.exists(self.path + "database.json"):
                return {}
            with open(self.path + "database.json", "r", encoding="utf-8") as f:
                db = json.load(f)
            
            # 自动迁移：为旧数据添加 share_id 和 collaborative
            migrated = False
            if "data_basis" in db:
                for title, meta in db["data_basis"].items():
                    if not isinstance(meta, dict):
                        continue
                    if "share_id" not in meta:
                        meta["share_id"] = hashlib.md5(f"{title}{meta.get('created_at', 0)}".encode()).hexdigest()[:8]
                        migrated = True
                    if "collaborative" not in meta:
                        meta["collaborative"] = False
                        migrated = True
                    if "pin" not in meta:
                        meta["pin"] = False
                        migrated = True
                    else:
                        normalized_pin = bool(meta.get("pin", False))
                        if meta.get("pin") is not normalized_pin:
                            meta["pin"] = normalized_pin
                            migrated = True
                if self._ensure_basis_ids_in_db(db):
                    migrated = True
            if migrated:
                with open(self.path + "database.json", "w", encoding="utf-8") as f:
                    json.dump(db, f, indent=4, ensure_ascii=False)

        if _type == SHORT_TIME:
            return db["data_short"]
        elif _type == BASIS:
            return db["data_basis"]
        else:
            return {}

    def getBasisByShareId(self, share_id):
        """通过 share_id 查找知识点"""
        with open(self.path + "database.json", "r", encoding="utf-8") as f:
            db = json.load(f)
        changed = self._ensure_basis_ids_in_db(db)
        if changed:
            with open(self.path + "database.json", "w", encoding="utf-8") as f:
                json.dump(db, f, indent=4, ensure_ascii=False)
        for title, meta in db["data_basis"].items():
            if meta.get("share_id") == share_id:
                return title, meta
        return None, None

    def updateBasisSettings(self, old_title, new_title=None, is_public=None, is_collaborative=None):
        """更新基础知识设置"""
        lock = get_user_lock(self.user)
        with lock:
            with open(self.path + "database.json", "r", encoding="utf-8") as f:
                db = json.load(f)
            
            if old_title not in db["data_basis"]:
                return False, "知识点不存在"
            
            meta = db["data_basis"][old_title]
            
            if is_public is not None:
                meta["public"] = is_public
            if is_collaborative is not None:
                meta["collaborative"] = is_collaborative
            
            if new_title and new_title != old_title:
                if new_title in db["data_basis"]:
                    return False, "新标题已存在"
                # 迁移数据
                db["data_basis"][new_title] = db["data_basis"].pop(old_title)
                # 更新知识图谱
                graph = self.get_knowledge_graph()
                for cat in graph["categories"].values():
                    if old_title in cat["knowledge_ids"]:
                        cat["knowledge_ids"] = [new_title if tid == old_title else tid for tid in cat["knowledge_ids"]]
                for conn in graph["connections"]:
                    if conn["from"] == old_title: conn["from"] = new_title
                    if conn["to"] == old_title: conn["to"] = new_title
                if "knowledge_nodes" in graph and old_title in graph["knowledge_nodes"]:
                    graph["knowledge_nodes"][new_title] = graph["knowledge_nodes"].pop(old_title)
                self.save_knowledge_graph(graph)
                
            meta["updated_at"] = time.time()
            with open(self.path + "database.json", "w", encoding="utf-8") as f:
                json.dump(db, f, indent=4, ensure_ascii=False)
            return True, "更新成功"
        
    def updateBasisVectorTime(self, title):
        """更新知识向量时间戳"""
        lock = get_user_lock(self.user)
        with lock:
            with open(self.path + "database.json", "r", encoding="utf-8") as f:
                db = json.load(f)

            if title not in db["data_basis"]:
                return False, "知识不存在"

            db["data_basis"][title]["vector_updated_at"] = time.time()
            with open(self.path + "database.json", "w", encoding="utf-8") as f:
                json.dump(db, f, indent=4, ensure_ascii=False)
            return True, "OK"

    def addShort(self, title):
        lock = get_user_lock(self.user)
        with lock:
            with open(self.path + "database.json", "r", encoding="utf-8") as f:
                db = json.load(f)
            
            # 找到已存在的最大ID
            max_id = -1
            for k in db["data_short"].keys():
                try:
                    curr_id = int(k)
                    if curr_id > max_id:
                        max_id = curr_id
                except ValueError:
                    pass
            
            ID = max_id + 1
            
            db["data_short"][str(ID)] = title
            with open(self.path + "database.json", "w", encoding="utf-8") as f:
                json.dump(db, f, indent=4, ensure_ascii=False)
        return True
    
    def addBasis(self, title, context, url):
        lock = get_user_lock(self.user)
        with lock:
            with open(self.path + "database.json", "r", encoding="utf-8") as f:
                db = json.load(f)

            # 找到已存在的最大ID（根据文件名 xxx.txt）
            max_id = 0
            if db["data_basis"]:
                for item in db["data_basis"].values():
                    src = item["src"]
                    try:
                        basename = os.path.basename(src)
                        if basename.endswith('.txt'):
                            curr_id = int(basename[:-4])
                            if curr_id > max_id:
                                max_id = curr_id
                    except (ValueError, IndexError):
                        pass

            ID = max_id + 1
            share_id = hashlib.md5(f"{title}{time.time()}".encode()).hexdigest()[:8]
            basis_id = self._build_basis_id(title, {
                "src": f"./data/users/{self.user}/database/{ID}.txt",
                "created_at": time.time(),
                "share_id": share_id,
            })
            db["data_basis"][title] = {
                "src": f"./data/users/{self.user}/database/{ID}.txt",
                "url": url,
                "public": False,  # 默认不公开
                "collaborative": False, # 默认不开启协同编辑
                "pin": False,
                "share_id": share_id,
                "basis_id": basis_id,
                "created_at": time.time(),
                "updated_at": time.time(),
                "vector_updated_at": 0
            }
            with open(f"./data/users/{self.user}/database/{ID}.txt", "w", encoding="utf-8") as f:
                f.write(context)

            with open(self.path + "database.json", "w", encoding="utf-8") as f:
                json.dump(db, f, indent=4, ensure_ascii=False)
        # 自动扫描连接
        self.auto_link_knowledge(title)
        return True

    def setBasisPublic(self, title, is_public=True):
        """设置知识公开状态"""
        lock = get_user_lock(self.user)
        try:
            with lock:
                with open(self.path + "database.json", "r", encoding="utf-8") as f:
                    db = json.load(f)

                if title in db["data_basis"]:
                    db["data_basis"][title]["public"] = is_public
                    db["data_basis"][title]["updated_at"] = time.time()
                    with open(self.path + "database.json", "w", encoding="utf-8") as f:
                        json.dump(db, f, indent=4, ensure_ascii=False)
                    return True, "设置成功"
                return False, "知识不存在"
        except Exception as e:
            return False, str(e)

    def setBasisPin(self, title, pin=True):
        """设置基础知识置顶状态"""
        lock = get_user_lock(self.user)
        try:
            with lock:
                with open(self.path + "database.json", "r", encoding="utf-8") as f:
                    db = json.load(f)

                if title not in db.get("data_basis", {}):
                    return False, "知识不存在"

                meta = db["data_basis"].get(title, {})
                if not isinstance(meta, dict):
                    return False, "知识元数据异常"

                meta["pin"] = bool(pin)
                meta["pin_updated_at"] = time.time()

                with open(self.path + "database.json", "w", encoding="utf-8") as f:
                    json.dump(db, f, indent=4, ensure_ascii=False)
                return True, "设置成功"
        except Exception as e:
            return False, str(e)

    def isBasisPublic(self, title):
        """检查知识点是否公开"""
        try:
            with open(self.path + "database.json", "r", encoding="utf-8") as f:
                db = json.load(f)
            if title in db["data_basis"]:
                return db["data_basis"][title].get("public", False)
            return False
        except:
            return False

    def getBasisMetadata(self, title):
        """获取元数据"""
        try:
            with open(self.path + "database.json", "r", encoding="utf-8") as f:
                db = json.load(f)
            return db["data_basis"].get(title)
        except:
            return None

    def auto_link_knowledge(self, title):
        """
        自动扫描指定知识点内容，建立与其他知识点的连接
        1. 提及链接：内容中出现了其他知识点的标题
        2. 脉络链接：内容中包含特定逻辑词汇（如"导致"、"下一步"等）
        """
        content = self.getBasisContent(title)
        db = self.getKnowledgeList(1)
        graph = self.get_knowledge_graph()
        
        all_titles = list(db.keys())
        changed = False
        
        # 1. 扫描标题匹配 (提及)
        for other_title in all_titles:
            if other_title == title: continue
            
            # 只有当内容中包含其他标题且目前尚未建立连接时
            if other_title in content:
                # 检查是否已存在
                exists = False
                for conn in graph["connections"]:
                    if (conn["from"] == title and conn["to"] == other_title) or \
                       (conn["from"] == other_title and conn["to"] == title):
                        exists = True
                        break
                
                if not exists:
                    conn_id = f"{title}-{other_title}-auto"
                    graph["connections"].append({
                        "id": conn_id,
                        "from": title,
                        "to": other_title,
                        "type": "提及",
                        "description": "内容中自动检测到关键词",
                        "created_at": time.time(),
                        "auto": True
                    })
                    changed = True
        
        # 2. 扫描逻辑词 (脉络/演化)
        # 简单的启发式：如果 B 在 A 的内容中被提及，且伴随逻辑词，标记为"脉络"
        logic_words = ["导致", "演化", "下一步", "随后", "生成", "演进", "属于", "依赖"]
        for conn in graph["connections"]:
            if conn.get("auto") and conn["from"] == title:
                target = conn["to"]
                # 查找 target 周围是否有逻辑词
                idx = content.find(target)
                if idx != -1:
                    context = content[max(0, idx-20):min(len(content), idx+len(target)+20)]
                    for word in logic_words:
                        if word in context:
                            conn["type"] = "脉络"
                            conn["description"] = f"检测到逻辑词: {word}"
                            changed = True
                            break

        if changed:
            self.save_knowledge_graph(graph)
        return changed

    def removeShort(self, ID):
        with open(self.path + "database.json", "r", encoding="utf-8") as f:
            db = json.load(f)

        del db["data_short"][str(ID)]

        with open(self.path + "database.json", "w", encoding="utf-8") as f:
            json.dump(db, f, indent=4, ensure_ascii=False)
        return True
    
    def removeBasis(self, title):
        with open(self.path + "database.json", "r", encoding="utf-8") as f:
            db = json.load(f)

        if title not in db["data_basis"]:
            return False, "Title not found"

        os.remove(db["data_basis"][title]["src"])
        del db["data_basis"][title]

        with open(self.path + "database.json", "w", encoding="utf-8") as f:
            json.dump(db, f, indent=4, ensure_ascii=False)
            
        # 清理知识图谱中的该节点及其连接
        graph = self.get_knowledge_graph()
        # 从分类中移除
        for cat in graph["categories"].values():
            if title in cat["knowledge_ids"]:
                cat["knowledge_ids"].remove(title)
        # 移除连接
        graph["connections"] = [c for c in graph["connections"] if c["from"] != title and c["to"] != title]
        # 移除节点坐标
        if "knowledge_nodes" in graph and title in graph["knowledge_nodes"]:
            del graph["knowledge_nodes"][title]
            
        self.save_knowledge_graph(graph)
        return True, "删除成功"
    
    def getBasisContent(
        self,
        title=None,
        basis_id=None,
        keyword=None,
        range_size=None,
        from_pos=None,
        to_pos=None,
        regex_mode=False,
        max_matches=5,
        case_sensitive=True
    ):
        lock = get_user_lock(self.user)
        with lock:
            with open(self.path + "database.json", "r", encoding="utf-8") as f:
                db = json.load(f)
            changed = self._ensure_basis_ids_in_db(db)
            resolved_title, basis_meta, err = self._resolve_basis_title_and_meta(
                db, title=title, basis_id=basis_id
            )
            if changed:
                with open(self.path + "database.json", "w", encoding="utf-8") as f:
                    json.dump(db, f, indent=4, ensure_ascii=False)

        if not resolved_title or not isinstance(basis_meta, dict):
            raise KeyError(err or "basis not found")

        title = resolved_title
        resolved_basis_id = str(basis_meta.get("basis_id") or "").strip()
        src = basis_meta["src"]
        with open(src, "r", encoding="utf-8") as f:
            content = f.read()

        has_slice = from_pos is not None or to_pos is not None
        has_keyword = bool(str(keyword or "").strip())
        has_range_arg = range_size is not None

        # 兼容旧行为：无任何筛选参数时返回全文
        if not has_slice and not has_keyword and not has_range_arg and not regex_mode:
            return content

        # 避免误调用：仅传 range 但未提供 keyword/区间时，不返回全文
        if has_range_arg and not has_keyword and not has_slice:
            return json.dumps({
                "success": False,
                "message": "range requires keyword, or use from_pos/to_pos for slice mode"
            }, ensure_ascii=False)

        # regex 模式必须提供 keyword（正则表达式）
        if regex_mode and not has_keyword:
            return json.dumps({
                "success": False,
                "message": "regex mode requires keyword pattern"
            }, ensure_ascii=False)

        total_len = len(content)

        # 1) 按索引区间读取
        if has_slice:
            try:
                start = 0 if from_pos is None else int(from_pos)
                end = total_len if to_pos is None else int(to_pos)
            except Exception:
                return json.dumps({
                    "success": False,
                    "message": "from_pos/to_pos must be integers"
                }, ensure_ascii=False)

            start = max(0, min(start, total_len))
            end = max(0, min(end, total_len))
            if end < start:
                start, end = end, start

            return json.dumps({
                "success": True,
                "mode": "slice",
                "title": title,
                "basis_id": resolved_basis_id,
                "from_pos": start,
                "to_pos": end,
                "total_length": total_len,
                "content": content[start:end]
            }, ensure_ascii=False)

        # 2) 关键词邻域 / regex 邻域读取
        try:
            window = int(range_size if range_size is not None else 120)
        except Exception:
            window = 120
        window = max(0, min(window, 10000))

        try:
            max_n = int(max_matches if max_matches is not None else 5)
        except Exception:
            max_n = 5
        max_n = max(1, min(max_n, 100))

        key = str(keyword or "")
        matches = []

        if regex_mode:
            flags = 0 if case_sensitive else re.IGNORECASE
            try:
                pattern = re.compile(key, flags)
            except Exception as e:
                return json.dumps({
                    "success": False,
                    "mode": "regex",
                    "message": f"invalid regex: {e}"
                }, ensure_ascii=False)

            for idx, m in enumerate(pattern.finditer(content), start=1):
                if idx > max_n:
                    break
                s, e = m.span()
                left = max(0, s - window)
                right = min(total_len, e + window)
                matches.append({
                    "index": idx,
                    "article": title,
                    "start": s,
                    "end": e,
                    "start_line": self._char_to_line_col(content, s)[0],
                    "start_col": self._char_to_line_col(content, s)[1],
                    "match": m.group(0),
                    "snippet": content[left:right]
                })
        else:
            hay = content if case_sensitive else content.lower()
            needle = key if case_sensitive else key.lower()
            pos = 0
            idx = 0
            while True:
                found = hay.find(needle, pos)
                if found == -1:
                    break
                idx += 1
                if idx > max_n:
                    break
                s = found
                e = found + len(needle)
                left = max(0, s - window)
                right = min(total_len, e + window)
                matches.append({
                    "index": idx,
                    "article": title,
                    "start": s,
                    "end": e,
                    "start_line": self._char_to_line_col(content, s)[0],
                    "start_col": self._char_to_line_col(content, s)[1],
                    "match": content[s:e],
                    "snippet": content[left:right]
                })
                pos = found + max(1, len(needle))

        return json.dumps({
            "success": True,
            "mode": "regex" if regex_mode else "keyword",
            "title": title,
            "basis_id": resolved_basis_id,
            "keyword": key,
            "range": window,
            "max_matches": max_n,
            "case_sensitive": bool(case_sensitive),
            "total_length": total_len,
            "matched": len(matches),
            "matches": matches
        }, ensure_ascii=False)

    def updateBasisContent(self, title, content):
        with open(self.path + "database.json", "r", encoding="utf-8") as f:
            db = json.load(f)
        
        if title not in db["data_basis"]:
            return False, "Title not found"
            
        src = db["data_basis"][title]["src"]
        try:
            with open(src, "w", encoding="utf-8") as f:
                f.write(content)
            db["data_basis"][title]["updated_at"] = time.time()
            db["data_basis"][title]["vector_updated_at"] = 0
            with open(self.path + "database.json", "w", encoding="utf-8") as f:
                json.dump(db, f, indent=4, ensure_ascii=False)
            # 更新内容后重新扫描链接
            self.auto_link_knowledge(title)
            return True, "Success"
        except Exception as e:
            return False, str(e)
    
    def updateBasis(
        self,
        title,
        new_title=None,
        context=None,
        url=None,
        is_public=None,
        is_collaborative=None,
        from_pos=None,
        to_pos=None,
        replacement=None,
        replacements=None
    ):
        """更新基础知识，支持修改标题、整段内容、URL、区间替换（单次/批量）"""
        with open(self.path + "database.json", "r", encoding="utf-8") as f:
            db = json.load(f)
        
        if title not in db["data_basis"]:
            return False, "Title not found"
        
        # 获取旧的记录
        old_record = db["data_basis"][title]
        src = old_record["src"]
        
        has_range_replace = (
            from_pos is not None
            or to_pos is not None
            or replacement is not None
            or (isinstance(replacements, list) and len(replacements) > 0)
        )

        if context is not None and has_range_replace:
            return False, "context and range replacement are mutually exclusive"

        content_updated = False

        # 更新内容（整段覆盖）
        if context is not None:
            try:
                with open(src, "r", encoding="utf-8") as f:
                    original = f.read()
                new_content = str(context)
                if new_content == original:
                    content_updated = False
                else:
                    with open(src, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    content_updated = True
            except Exception as e:
                return False, f"Failed to update content: {str(e)}"
        # 更新内容（区间替换）
        elif has_range_replace:
            try:
                with open(src, "r", encoding="utf-8") as f:
                    original = f.read()
                current = original

                ops = []
                if isinstance(replacements, list) and replacements:
                    for item in replacements:
                        if not isinstance(item, dict):
                            return False, "replacements must be a list of objects"
                        s = item.get("from_pos")
                        e = item.get("to_pos")
                        rep = item.get("replacement", "")
                        if s is None or e is None:
                            return False, "each replacement requires from_pos and to_pos"
                        ops.append((int(s), int(e), str(rep)))
                else:
                    s = 0 if from_pos is None else int(from_pos)
                    e = len(current) if to_pos is None else int(to_pos)
                    rep = "" if replacement is None else str(replacement)
                    ops.append((s, e, rep))

                # 倒序替换，避免索引偏移
                for s, e, rep in sorted(ops, key=lambda x: x[0], reverse=True):
                    if s < 0 or e < 0:
                        return False, "range index cannot be negative"
                    if s > e:
                        s, e = e, s
                    if e > len(current):
                        return False, f"range out of bounds: ({s}, {e}) > {len(current)}"
                    current = current[:s] + rep + current[e:]

                if current != original:
                    with open(src, "w", encoding="utf-8") as f:
                        f.write(current)
                    content_updated = True
                else:
                    content_updated = False
            except Exception as e:
                return False, f"Failed to apply range replacement: {str(e)}"
        
        # 更新URL（如果提供）
        if url is not None:
            old_record["url"] = url
        # 更新公开/协作设置（如果提供）
        if is_public is not None:
            old_record["public"] = bool(is_public)
        if is_collaborative is not None:
            old_record["collaborative"] = bool(is_collaborative)
        
        # 更新标题（如果提供且不同）
        if new_title and new_title != title:
            # 检查新标题是否已存在
            if new_title in db["data_basis"]:
                return False, "New title already exists"
            
            # 移除旧标题，添加新标题
            db["data_basis"][new_title] = old_record
            del db["data_basis"][title]
            
            # 更新知识图谱中的引用
            self._update_knowledge_graph_title(title, new_title)
        
        old_record["updated_at"] = time.time()
        if content_updated:
            old_record["vector_updated_at"] = 0

        # 保存更新
        with open(self.path + "database.json", "w", encoding="utf-8") as f:
            json.dump(db, f, indent=4, ensure_ascii=False)
        
        return True, "Success"
    
    def _update_knowledge_graph_title(self, old_title, new_title):
        """更新知识图谱中的知识标题引用"""
        graph_file = self.path + "knowledge_graph.json"
        
        try:
            with open(graph_file, "r", encoding="utf-8") as f:
                graph = json.load(f)
            
            # 更新categories中的knowledge_ids
            for category in graph.get("categories", {}).values():
                if old_title in category.get("knowledge_ids", []):
                    idx = category["knowledge_ids"].index(old_title)
                    category["knowledge_ids"][idx] = new_title
            
            # 更新connections中的引用
            for conn in graph.get("connections", []):
                if conn.get("source") == old_title:
                    conn["source"] = new_title
                if conn.get("target") == old_title:
                    conn["target"] = new_title
            
            with open(graph_file, "w", encoding="utf-8") as f:
                json.dump(graph, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"Warning: Failed to update knowledge graph: {e}")
    
    # ==================== Token 统计日志 ====================
    
    def log_token_usage(
        self,
        conversation_id,
        conversation_title,
        action_type,
        input_tokens,
        output_tokens,
        total_tokens=None,
        metadata=None
    ):
        """记录Token使用情况"""
        log_file = self.path + "token_usage.json"
        metadata = metadata if isinstance(metadata, dict) else {}
        input_tokens = int(input_tokens or 0)
        output_tokens = int(output_tokens or 0)
        if total_tokens is None:
            total_tokens = input_tokens + output_tokens
        total_tokens = int(total_tokens or 0)

        # 确保日志文件存在
        if not os.path.exists(log_file):
            with open(log_file, "w", encoding="utf-8") as f:
                json.dump([], f, indent=4, ensure_ascii=False)

        try:
            with open(log_file, "r", encoding="utf-8") as f:
                logs = json.load(f)
        except:
            logs = []

        # 添加新日志
        log_entry = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
            "conversation_id": conversation_id,
            "conversation_title": conversation_title,
            "action": action_type,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "provider": metadata.get("provider") or "",
            "model": metadata.get("model") or "",
            "token_details": metadata.get("token_details") or {},
            "has_web_search": bool(metadata.get("has_web_search", False)),
            "tool_call_count": int(metadata.get("tool_call_count", 0) or 0)
        }

        logs.insert(0, log_entry)  # 最新的在最前

        # 限制日志数量（例如保留最近1000条）
        if len(logs) > 1000:
            logs = logs[:1000]

        with open(log_file, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=4, ensure_ascii=False)

        # 同时更新全局 user.json 中的累计 token 消耗
        try:
            users_meta_path = "./data/user.json"
            if os.path.exists(users_meta_path):
                with _global_file_lock:  # 使用锁保护全局文件的读写操作
                    with open(users_meta_path, "r", encoding="utf-8") as f:
                        users_data = json.load(f)

                    if self.user in users_data:
                        current_usage = users_data[self.user].get("token_usage", 0)
                        users_data[self.user]["token_usage"] = current_usage + total_tokens

                        with open(users_meta_path, "w", encoding="utf-8") as f:
                            json.dump(users_data, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"Error updating global token usage: {e}")

    def get_token_logs(self):
        """获取Token使用日志"""
        log_file = self.path + "token_usage.json"
        if not os.path.exists(log_file):
            return []
        try:
            with open(log_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return []

    # ==================== 笔记云存储 ====================

    def _notes_store_path(self):
        return self.path + "notes_store.json"

    def _default_notes_store(self):
        now_ts = int(time.time())
        return {
            "activeNotebookId": "nb_default",
            "notebooks": [
                {
                    "id": "nb_default",
                    "name": "默认笔记本",
                    "ts": now_ts
                }
            ],
            "notes": []
        }

    def _normalize_note_anchor(self, raw):
        if not isinstance(raw, dict):
            return None
        anchor_type = str(raw.get("type", "")).strip()
        if anchor_type == "chat":
            conversation_id = str(raw.get("conversationId", "")).strip()[:128]
            message_role = str(raw.get("messageRole", "")).strip()
            if message_role not in {"assistant", "user"}:
                message_role = ""
            message_index = raw.get("messageIndex", None)
            try:
                if message_index is None or message_index == "":
                    message_index = None
                else:
                    message_index = max(0, int(message_index))
            except Exception:
                message_index = None
            snippet = str(raw.get("snippet", "")).strip()[:600]
            plain_snippet = str(raw.get("plainSnippet", "")).strip()[:600]
            return {
                "type": "chat",
                "conversationId": conversation_id,
                "messageIndex": message_index,
                "messageRole": message_role,
                "snippet": snippet,
                "plainSnippet": plain_snippet
            }
        if anchor_type == "knowledge":
            title = str(raw.get("title", "")).strip()[:200]
            snippet = str(raw.get("snippet", "")).strip()[:600]
            plain_snippet = str(raw.get("plainSnippet", "")).strip()[:600]
            return {
                "type": "knowledge",
                "title": title,
                "snippet": snippet,
                "plainSnippet": plain_snippet
            }
        return None

    def _normalize_notes_store(self, raw):
        src = raw if isinstance(raw, dict) else {}
        default = self._default_notes_store()

        notebooks_raw = src.get("notebooks", [])
        if not isinstance(notebooks_raw, list):
            notebooks_raw = []

        notebooks = []
        notebook_ids = set()
        now_ts = int(time.time())
        for idx, item in enumerate(notebooks_raw):
            if not isinstance(item, dict):
                continue
            notebook_id = str(item.get("id", "")).strip() or f"nb_{now_ts}_{idx}"
            if notebook_id in notebook_ids:
                continue
            notebook_name = str(item.get("name", "")).strip() or "未命名笔记本"
            try:
                notebook_ts = int(item.get("ts", now_ts) or now_ts)
            except Exception:
                notebook_ts = now_ts
            notebooks.append({
                "id": notebook_id,
                "name": notebook_name[:64],
                "ts": notebook_ts
            })
            notebook_ids.add(notebook_id)

        if not notebooks:
            notebooks = default["notebooks"]
            notebook_ids = {default["notebooks"][0]["id"]}

        active_notebook_id = str(src.get("activeNotebookId", "")).strip()
        if not active_notebook_id or active_notebook_id not in notebook_ids:
            active_notebook_id = notebooks[0]["id"]

        notes_raw = src.get("notes", [])
        if not isinstance(notes_raw, list):
            notes_raw = []

        normalized_notes = []
        for idx, item in enumerate(notes_raw):
            if not isinstance(item, dict):
                continue
            text = str(item.get("text", "")).strip()
            if not text:
                continue

            note_notebook_id = str(item.get("notebookId", "")).strip()
            if note_notebook_id not in notebook_ids:
                note_notebook_id = active_notebook_id

            note_id = str(item.get("id", "")).strip() or f"note_{now_ts}_{idx}"
            source = str(item.get("source", "聊天")).strip() or "聊天"
            source_title = str(item.get("sourceTitle", "")).strip()
            anchor = self._normalize_note_anchor(item.get("anchor"))
            try:
                note_ts = int(item.get("ts", now_ts) or now_ts)
            except Exception:
                note_ts = now_ts

            normalized_notes.append({
                "id": note_id,
                "notebookId": note_notebook_id,
                "text": text[:12000],
                "source": source[:64],
                "sourceTitle": source_title[:200],
                "anchor": anchor,
                "ts": note_ts
            })

        # 防止单用户笔记无限增长
        if len(normalized_notes) > 6000:
            normalized_notes = normalized_notes[:6000]

        return {
            "activeNotebookId": active_notebook_id,
            "notebooks": notebooks,
            "notes": normalized_notes
        }

    def get_notes_store(self):
        """读取用户笔记云存储，若不存在则自动初始化。"""
        lock = get_user_lock(self.user)
        with lock:
            fpath = self._notes_store_path()
            if not os.path.exists(fpath):
                data = self._default_notes_store()
                with open(fpath, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                return data

            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    raw = json.load(f)
            except Exception:
                raw = self._default_notes_store()

            normalized = self._normalize_notes_store(raw)
            try:
                with open(fpath, "w", encoding="utf-8") as f:
                    json.dump(normalized, f, indent=2, ensure_ascii=False)
            except Exception:
                pass
            return normalized

    def save_notes_store(self, store):
        """保存用户笔记云存储，返回归一化后的结果。"""
        normalized = self._normalize_notes_store(store)
        lock = get_user_lock(self.user)
        with lock:
            fpath = self._notes_store_path()
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump(normalized, f, indent=2, ensure_ascii=False)
        return normalized

    # ==================== 知识图谱管理 ====================
    
    def set_knowledge_category(self, title, category_name):
        """设置知识的分类"""
        graph = self.get_knowledge_graph()
        
        # 检查分类是否存在
        if category_name not in graph["categories"]:
            # 如果不存在，尝试自动创建（或者报错）
            # 这里我们选择报错，要求先创建分类
            return False, f"分类 '{category_name}' 不存在，请先创建分类"
        
        # 1. 查找知识目前所在的分类并移除
        for cat_name, cat_data in graph["categories"].items():
            if title in cat_data["knowledge_ids"]:
                cat_data["knowledge_ids"].remove(title)
        
        # 2. 添加到新分类
        graph["categories"][category_name]["knowledge_ids"].append(title)
        
        self.save_knowledge_graph(graph)
        return True, f"已将 '{title}' 移动到分类 '{category_name}'"

    def get_knowledge_graph(self):
        """获取知识图谱数据"""
        with open(self.path + "knowledge_graph.json", "r", encoding="utf-8") as f:
            return json.load(f)
    
    def save_knowledge_graph(self, graph_data):
        """保存知识图谱数据"""
        with open(self.path + "knowledge_graph.json", "w", encoding="utf-8") as f:
            json.dump(graph_data, f, indent=4, ensure_ascii=False)
    
    def create_category(self, category_name, color="#667eea", position=None):
        """创建知识分类"""
        graph = self.get_knowledge_graph()
        
        if category_name in graph["categories"]:
            return False, "分类已存在"
        
        if position is None:
            position = {"x": 0, "y": len(graph["categories"]) * 150}
        
        graph["categories"][category_name] = {
            "name": category_name,
            "color": color,
            "knowledge_ids": [],
            "position": position
        }
        graph["category_order"].append(category_name)
        
        self.save_knowledge_graph(graph)
        return True, "创建成功"
    
    def delete_category(self, category_name):
        """删除分类（将知识移到未分类）"""
        graph = self.get_knowledge_graph()
        
        if category_name not in graph["categories"]:
            return False, "分类不存在"
        
        if category_name == "未分类":
            return False, "不能删除未分类"
        
        # 将该分类的知识移到未分类
        knowledge_ids = graph["categories"][category_name]["knowledge_ids"]
        graph["categories"]["未分类"]["knowledge_ids"].extend(knowledge_ids)
        
        # 删除分类
        del graph["categories"][category_name]
        graph["category_order"].remove(category_name)
        
        self.save_knowledge_graph(graph)
        return True, "删除成功"
    
    def update_category(self, old_name, new_name, color=None):
        """更新分类名称和颜色"""
        graph = self.get_knowledge_graph()
        
        if old_name not in graph["categories"]:
            return False, "分类不存在"
        
        if old_name == "未分类":
            return False, "不能修改未分类"
        
        # 如果名称改变了，检查新名称是否已存在
        if old_name != new_name and new_name in graph["categories"]:
            return False, "分类名称已存在"
        
        # 获取旧分类数据
        old_category = graph["categories"][old_name]
        
        # 如果名称改变
        if old_name != new_name:
            # 创建新分类（保留所有数据）
            graph["categories"][new_name] = old_category.copy()
            
            # 更新知识节点中的分类引用
            if "knowledge_nodes" in graph:
                for title, node in graph["knowledge_nodes"].items():
                    if node.get("category") == old_name:
                        node["category"] = new_name
            
            # 更新分类顺序
            idx = graph["category_order"].index(old_name)
            graph["category_order"][idx] = new_name
            
            # 删除旧分类
            del graph["categories"][old_name]
        
        # 更新颜色
        if color:
            graph["categories"][new_name]["color"] = color
        
        self.save_knowledge_graph(graph)
        return True, "更新成功"
    
    def move_knowledge_to_category(self, knowledge_title, category_name):
        """将知识移动到指定分类"""
        graph = self.get_knowledge_graph()
        
        if category_name not in graph["categories"]:
            return False, "分类不存在"
        
        # 从所有分类中移除该知识
        for cat in graph["categories"].values():
            if knowledge_title in cat["knowledge_ids"]:
                cat["knowledge_ids"].remove(knowledge_title)
        
        # 添加到目标分类
        if knowledge_title not in graph["categories"][category_name]["knowledge_ids"]:
            graph["categories"][category_name]["knowledge_ids"].append(knowledge_title)
        
        self.save_knowledge_graph(graph)
        return True, "移动成功"
    
    def add_connection(self, from_knowledge, to_knowledge, relation_type="关联", description=""):
        """添加知识之间的连接关系"""
        graph = self.get_knowledge_graph()
        
        connection = {
            "id": f"{from_knowledge}-{to_knowledge}-{int(time.time())}",
            "from": from_knowledge,
            "to": to_knowledge,
            "type": relation_type,
            "description": description,
            "created_at": time.time()
        }
        
        # 检查是否已存在相同连接
        for conn in graph["connections"]:
            if conn["from"] == from_knowledge and conn["to"] == to_knowledge:
                return False, "连接已存在"
        
        graph["connections"].append(connection)
        self.save_knowledge_graph(graph)
        return True, "添加成功"
    
    def remove_connection(self, connection_id):
        """删除连接"""
        graph = self.get_knowledge_graph()
        
        graph["connections"] = [c for c in graph["connections"] if c["id"] != connection_id]
        
        self.save_knowledge_graph(graph)
        return True, "删除成功"
    

    def get_knowledge_connections(self, knowledge_title=None):
        """获取某个知识的所有连接，如果不指定则返回所有"""
        graph = self.get_knowledge_graph()

        if not knowledge_title:
            return graph["connections"]

        connections = []
        for conn in graph["connections"]:
            if conn["from"] == knowledge_title or conn["to"] == knowledge_title:
                connections.append(conn)

        return connections

    def get_knowledge_graph_structure(self):
        """获取知识图谱的概览结构"""
        graph = self.get_knowledge_graph()
        structure = {
            "categories": [],
            "connections_count": len(graph.get("connections", []))
        }
        
        for name, data in graph.get("categories", {}).items():
            structure["categories"].append({
                "name": name,
                "knowledge_count": len(data.get("knowledge_ids", [])),
                "knowledge_list": data.get("knowledge_ids", [])
            })
            
        return structure

    def find_knowledge_path(self, start_title, end_title):
        """查找两个知识点之间的路径"""
        graph = self.get_knowledge_graph()
        connections = graph.get("connections", [])
        
        # 简单的BFS
        queue = [[start_title]]
        visited = {start_title}
        
        while queue:
            path = queue.pop(0)
            node = path[-1]
            
            if node == end_title:
                return path
            
            # 查找相邻节点
            for conn in connections:
                neighbor = None
                if conn["from"] == node:
                    neighbor = conn["to"]
                elif conn["to"] == node:
                    neighbor = conn["from"]
                
                if neighbor and neighbor not in visited:
                    visited.add(neighbor)
                    new_path = list(path)
                    new_path.append(neighbor)
                    queue.append(new_path)
                    
        return []

    def update_category_position(self, category_name, position):
        """更新分类位置（用于拖拽）"""
        graph = self.get_knowledge_graph()
        
        if category_name not in graph["categories"]:
            return False, "分类不存在"
        
        graph["categories"][category_name]["position"] = position
        self.save_knowledge_graph(graph)
        return True, "更新成功"    def search_keyword(self, keyword, range_size=10):
        """
        在短期记忆和基础知识库中搜索关键词并返回结构化命中信息。
        """
        key = str(keyword or "").strip()
        if not key:
            return json.dumps({"success": False, "message": "keyword is required"}, ensure_ascii=False)

        try:
            win = int(range_size)
        except Exception:
            win = 10
        win = max(0, min(win, 10000))

        lock = get_user_lock(self.user)
        with lock:
            with open(self.path + "database.json", "r", encoding="utf-8") as f:
                db = json.load(f)
            changed = self._ensure_basis_ids_in_db(db)
            if changed:
                with open(self.path + "database.json", "w", encoding="utf-8") as f:
                    json.dump(db, f, indent=4, ensure_ascii=False)

        matches = []
        article_stats = {}

        for short_id, short_title in db.get("data_short", {}).items():
            text = str(short_title or "")
            pos = text.find(key)
            while pos != -1:
                s = pos
                e = pos + len(key)
                left = max(0, s - win)
                right = min(len(text), e + win)
                line, col = self._char_to_line_col(text, s)
                article_name = f"short_memory:{short_id}"
                matches.append({
                    "source_type": "short_memory_title",
                    "article": article_name,
                    "short_id": str(short_id),
                    "start": s,
                    "end": e,
                    "line": line,
                    "col": col,
                    "match": text[s:e],
                    "snippet": text[left:right],
                })
                article_stats[article_name] = article_stats.get(article_name, 0) + 1
                pos = text.find(key, pos + max(1, len(key)))

        for basis_title, basis_info in db.get("data_basis", {}).items():
            meta = basis_info if isinstance(basis_info, dict) else {}
            basis_id = str(meta.get("basis_id") or "").strip()

            title_text = str(basis_title or "")
            title_pos = title_text.find(key)
            while title_pos != -1:
                s = title_pos
                e = s + len(key)
                left = max(0, s - win)
                right = min(len(title_text), e + win)
                line, col = self._char_to_line_col(title_text, s)
                matches.append({
                    "source_type": "knowledge_title",
                    "article": str(basis_title),
                    "title": str(basis_title),
                    "basis_id": basis_id,
                    "start": s,
                    "end": e,
                    "line": line,
                    "col": col,
                    "match": title_text[s:e],
                    "snippet": title_text[left:right],
                })
                article_stats[str(basis_title)] = article_stats.get(str(basis_title), 0) + 1
                title_pos = title_text.find(key, title_pos + max(1, len(key)))

            try:
                with open(meta.get("src", ""), "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception:
                continue

            start = 0
            count = 0
            while count < 20:
                pos = content.find(key, start)
                if pos == -1:
                    break
                s = pos
                e = pos + len(key)
                left = max(0, s - win)
                right = min(len(content), e + win)
                line, col = self._char_to_line_col(content, s)
                matches.append({
                    "source_type": "knowledge_content",
                    "article": str(basis_title),
                    "title": str(basis_title),
                    "basis_id": basis_id,
                    "start": s,
                    "end": e,
                    "line": line,
                    "col": col,
                    "match": content[s:e],
                    "snippet": content[left:right],
                })
                article_stats[str(basis_title)] = article_stats.get(str(basis_title), 0) + 1
                start = pos + max(1, len(key))
                count += 1

        grouped_articles = [{"article": k, "hits": v} for k, v in article_stats.items()]
        grouped_articles.sort(key=lambda x: (-int(x.get("hits") or 0), str(x.get("article") or "")))

        return json.dumps({
            "success": True,
            "keyword": key,
            "range": win,
            "matched": len(matches),
            "articles": grouped_articles,
            "matches": matches
        }, ensure_ascii=False)

if __name__ == "__main__":
    os.chdir("../")
    user = User("test_user")
