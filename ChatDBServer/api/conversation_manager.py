"""
对话管理器 - 管理用户的对话记录
"""
import os
import json
from datetime import datetime

from longterm.longterm_api import conversation_longterm_root_state, normalize_longterm_state


class ConversationManager:
    """对话记录管理类"""
    
    def __init__(self, username):
        """
        初始化对话管理器
        
        Args:
            username: 用户名
        """
        self.username = username
        self.base_path = f"./data/users/{username}/conversations"
        
        # 确保对话目录存在
        os.makedirs(self.base_path, exist_ok=True)
    
    def create_conversation(self, conversation_id=None, title="新对话"):
        """
        创建新对话
        
        Args:
            conversation_id: 对话ID，如果为None则自动生成数字ID
            title: 对话标题
            
        Returns:
            str: 对话ID
        """
        if conversation_id is None:
            # 使用数字生成对话ID
            existing_ids = []
            if os.path.exists(self.base_path):
                for filename in os.listdir(self.base_path):
                    if filename.endswith('.json'):
                        try:
                            existing_ids.append(int(filename[:-5]))
                        except ValueError:
                            pass
            
            # 生成新ID（最大ID + 1）
            conversation_id = str(max(existing_ids) + 1) if existing_ids else "1"
        
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        
        # 创建对话记录
        conversation_data = {
            "conversation_id": conversation_id,
            "title": title,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "pin": False,
            "messages": [],
            "conversation_mode": "chat",
            "longterm": conversation_longterm_root_state()
        }
        
        with open(conversation_path, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, ensure_ascii=False, indent=2)
        
        return conversation_id
    
    def update_title(self, conversation_id, title):
        """
        更新对话标题
        
        Args:
            conversation_id: 对话ID
            title: 新标题
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        
        if not os.path.exists(conversation_path):
            raise ValueError(f"对话不存在: {conversation_id}")
        
        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)
        
        conversation_data["title"] = title
        conversation_data["updated_at"] = datetime.now().isoformat()
        
        with open(conversation_path, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, ensure_ascii=False, indent=2)
    
    def update_conversation_title(self, conversation_id, title):
        """
        更新对话标题
        
        Args:
            conversation_id: 对话ID
            title: 新标题
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        
        if not os.path.exists(conversation_path):
            raise ValueError(f"对话不存在: {conversation_id}")
        
        # 读取对话
        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)
        
        # 更新标题
        conversation_data["title"] = title
        conversation_data["updated_at"] = datetime.now().isoformat()
        
        # 保存对话
        with open(conversation_path, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, ensure_ascii=False, indent=2)

    def update_volc_response_id(self, conversation_id, response_id, model_name=None):
        """
        更新VolcEngine的Response ID，用于上下文续接
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            return
        
        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)
        
        conversation_data["last_volc_response_id"] = response_id
        if model_name:
             conversation_data["last_model_used"] = model_name
        
        with open(conversation_path, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, ensure_ascii=False, indent=2)

    def update_conversation_fields(self, conversation_id, fields):
        """
        批量更新会话根字段，遇到字典值时做浅合并。
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            raise ValueError(f"对话不存在: {conversation_id}")
        if not isinstance(fields, dict):
            raise ValueError("fields 必须是字典")

        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)

        for key, value in fields.items():
            if isinstance(value, dict) and isinstance(conversation_data.get(key), dict):
                merged = dict(conversation_data.get(key) or {})
                merged.update(value)
                conversation_data[key] = merged
            else:
                conversation_data[key] = value

        conversation_data["updated_at"] = datetime.now().isoformat()
        with open(conversation_path, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, ensure_ascii=False, indent=2)

    def update_last_response_id(self, conversation_id, response_id, model_name=None):
        """
        更新可续接的 last response id（通用命名，兼容历史 volc 命名字段）
        """
        self.update_volc_response_id(conversation_id, response_id, model_name=model_name)

    def _invalidate_resume_cache_fields(self, conversation_data):
        """
        会话分支被本地改写（删消息/切版本）后，必须清理远端续接ID，
        否则下次请求会沿用旧 remote context，导致与当前可见历史不一致。
        """
        if not isinstance(conversation_data, dict):
            return
        for key in ("last_volc_response_id", "last_model_used"):
            if key in conversation_data:
                try:
                    del conversation_data[key]
                except Exception:
                    conversation_data[key] = None
            
    def get_last_volc_response_id(self, conversation_id, current_model_name=None):
        """
        获取VolcEngine的Last Response ID
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            return None
            
        with open(conversation_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            last_id = data.get("last_volc_response_id")
            last_model = data.get("last_model_used")

            def _norm_model_name(v):
                return str(v or "").strip().lower()
            current_model_norm = _norm_model_name(current_model_name)
            last_model_norm = _norm_model_name(last_model)

            # Check for model compatibility
            # logic: if current model is known, and (last_model is different OR missing), reset it.
            # (Assuming missing last_model implies it was the default/old model, 
            # so if we are using a specific new model, it's a mismatch).
            if current_model_norm and last_model_norm and last_model_norm != current_model_norm:
                print(f"[CACHE] Model mismatch. Last: {last_model}, Current: {current_model_name}. Resetting context ID.")
                return None
            
            return last_id

    def get_last_response_id(self, conversation_id, current_model_name=None):
        """
        获取可续接的 last response id（通用命名，兼容历史 volc 命名字段）
        """
        return self.get_last_volc_response_id(conversation_id, current_model_name=current_model_name)

    def add_message(self, conversation_id, role, content, metadata=None, index=None):
        """
        添加消息到对话
        
        Args:
            conversation_id: 对话ID
            role: 角色 (user/assistant/function)
            content: 消息内容
            metadata: 额外元数据（如函数调用信息、交流总结等）
            index: 如果提供且有效，则覆盖该索引处的消息（用于重新生成覆盖旧回答）
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        
        if not os.path.exists(conversation_path):
            raise ValueError(f"对话不存在: {conversation_id}")
        
        # 读取对话
        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)
        
        # 准备消息
        message = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        }
        
        if index is not None and 0 <= index < len(conversation_data["messages"]):
            old_msg = conversation_data["messages"][index]
            old_metadata = old_msg.get("metadata", {}) if isinstance(old_msg.get("metadata", {}), dict) else {}
            old_versions = old_metadata.get("versions", [])
            if not isinstance(old_versions, list):
                old_versions = []

            if "metadata" not in message:
                message["metadata"] = {}
            # 覆盖写入时先继承既有版本链，避免重答过程中丢失版本历史
            message["metadata"]["versions"] = list(old_versions)

            # assistant 覆盖 assistant：把被覆盖的当前消息快照并入历史版本（原子保存）
            if role == "assistant" and str(old_msg.get("role", "")).strip() == "assistant":
                prev_content = old_msg.get("content", "")
                prev_ts = old_msg.get("timestamp", "")
                prev_meta_without_versions = {
                    k: v for k, v in old_metadata.items() if k != "versions"
                }
                prev_variant = {
                    "content": prev_content,
                    "timestamp": prev_ts,
                    "metadata": prev_meta_without_versions
                }
                if "exchange_summary" in old_msg:
                    prev_variant["exchange_summary"] = old_msg["exchange_summary"]

                has_meaningful_content = bool(str(prev_content or "").strip())
                has_meaningful_steps = bool(
                    isinstance(prev_meta_without_versions.get("process_steps"), list)
                    and len(prev_meta_without_versions.get("process_steps")) > 0
                )
                if has_meaningful_content or has_meaningful_steps:
                    existed = False
                    for v in message["metadata"]["versions"]:
                        if not isinstance(v, dict):
                            continue
                        if (
                            str(v.get("timestamp", "")) == str(prev_variant.get("timestamp", ""))
                            and str(v.get("content", "")) == str(prev_variant.get("content", ""))
                        ):
                            existed = True
                            break
                    if not existed:
                        message["metadata"]["versions"].append(prev_variant)

        # 合并新传入的 metadata
        if metadata:
            if "metadata" not in message:
                message["metadata"] = {}
            message["metadata"].update(metadata)
        
        # 如果是assistant消息，且有exchange_summary，记录这次交流的总结
        if role == "assistant" and metadata and "exchange_summary" in metadata:
            message["exchange_summary"] = metadata["exchange_summary"]
        if role == "assistant":
            model_name = ""
            if isinstance(message.get("metadata"), dict):
                model_name = str(message["metadata"].get("model_name", "") or "").strip()
            if model_name:
                message["model_name"] = model_name
            elif "model_name" in message:
                del message["model_name"]
        
        if index is not None and 0 <= index < len(conversation_data["messages"]):
            conversation_data["messages"][index] = message
        else:
            conversation_data["messages"].append(message)
            
        conversation_data["updated_at"] = datetime.now().isoformat()
        
        # 保存对话
        with open(conversation_path, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, ensure_ascii=False, indent=2)

    def delete_message(self, conversation_id, message_index):
        """
        删除指定索引所属的“单轮消息”
        - 点击 user：删除该 user 以及其后紧邻的 assistant（若存在）
        - 点击 assistant：删除该 assistant 以及其前紧邻的 user（若存在）
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            return False
            
        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)
            
        messages = conversation_data.get("messages", [])
        if 0 <= message_index < len(messages):
            start = message_index
            end = message_index
            role = str(messages[message_index].get('role') or '').strip()

            if role == 'user':
                # user + next assistant
                if message_index + 1 < len(messages):
                    next_role = str(messages[message_index + 1].get('role') or '').strip()
                    if next_role == 'assistant':
                        end = message_index + 1
            elif role == 'assistant':
                # prev user + assistant
                if message_index - 1 >= 0:
                    prev_role = str(messages[message_index - 1].get('role') or '').strip()
                    if prev_role == 'user':
                        start = message_index - 1

            del messages[start:end + 1]
            conversation_data["messages"] = messages
            self._invalidate_resume_cache_fields(conversation_data)
            
            conversation_data["updated_at"] = datetime.now().isoformat()
            
            with open(conversation_path, 'w', encoding='utf-8') as f:
                json.dump(conversation_data, f, ensure_ascii=False, indent=2)
            return True
        return False

    def save_message_version(self, conversation_id, message_index):
        """
        为指定消息保存一个历史版本（用于重新回答切换）
        将当前内容移入元数据的 versions 列表中
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            return False
            
        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)
            
        messages = conversation_data.get("messages", [])
        if 0 <= message_index < len(messages):
            msg = messages[message_index]
            if msg.get('role') != 'assistant':
                return False
                
            # 初始化 metadata 和 versions
            if "metadata" not in msg:
                msg["metadata"] = {}
            if "versions" not in msg["metadata"]:
                msg["metadata"]["versions"] = []
                
            # 保存当前内容到版本列表 (不含 versions 自身以防无限嵌套)
            version_data = {
                "content": msg.get("content", ""),
                "timestamp": msg.get("timestamp", ""),
                "metadata": {k: v for k, v in msg.get("metadata", {}).items() if k != "versions"}
            }
            if "exchange_summary" in msg:
                version_data["exchange_summary"] = msg["exchange_summary"]

            has_meaningful_content = bool(str(version_data.get("content", "")).strip())
            has_meaningful_steps = bool(
                isinstance(version_data.get("metadata", {}).get("process_steps"), list)
                and len(version_data.get("metadata", {}).get("process_steps")) > 0
            )
            if has_meaningful_content or has_meaningful_steps:
                existed = False
                for v in msg["metadata"]["versions"]:
                    if not isinstance(v, dict):
                        continue
                    if (
                        str(v.get("timestamp", "")) == str(version_data.get("timestamp", ""))
                        and str(v.get("content", "")) == str(version_data.get("content", ""))
                    ):
                        existed = True
                        break
                if not existed:
                    msg["metadata"]["versions"].append(version_data)
            
            conversation_data["updated_at"] = datetime.now().isoformat()
            with open(conversation_path, 'w', encoding='utf-8') as f:
                json.dump(conversation_data, f, ensure_ascii=False, indent=2)
            return True
        return False

    def switch_message_version(self, conversation_id, message_index, version_index):
        """
        切换到指定的历史版本
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            return False
            
        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)
            
        messages = conversation_data.get("messages", [])
        if 0 <= message_index < len(messages):
            msg = messages[message_index]
            versions = msg.get("metadata", {}).get("versions", [])
            
            if 0 <= version_index <= len(versions):
                # 如果 version_index == len(versions)，表示当前就是最新（或正在切换回当前路径）
                # 这里逻辑需要稍微绕一下：versions里存的是“旧版本”
                # 我们把当前内容和目标版本互换
                
                # 简单做法：把当前所有可能的状态（当前+历史）看做一个池子
                all_variants = versions + [{
                    "content": msg.get("content", ""),
                    "timestamp": msg.get("timestamp", ""),
                    "metadata": {k: v for k, v in msg.get("metadata", {}).items() if k != "versions"},
                    "exchange_summary": msg.get("exchange_summary")
                }]
                
                target = all_variants[version_index]
                
                # 更新消息
                msg["content"] = target["content"]
                msg["timestamp"] = target["timestamp"]
                if target.get("exchange_summary"):
                    msg["exchange_summary"] = target["exchange_summary"]
                elif "exchange_summary" in msg:
                    del msg["exchange_summary"]
                
                # 更新元数据（保留 versions 列表）
                msg["metadata"] = target.get("metadata", {})
                msg["metadata"]["versions"] = [v for i, v in enumerate(all_variants) if i != version_index]
                model_name = str(msg.get("metadata", {}).get("model_name", "") or "").strip()
                if model_name:
                    msg["model_name"] = model_name
                elif "model_name" in msg:
                    del msg["model_name"]
                self._invalidate_resume_cache_fields(conversation_data)
                
                conversation_data["updated_at"] = datetime.now().isoformat()
                with open(conversation_path, 'w', encoding='utf-8') as f:
                    json.dump(conversation_data, f, ensure_ascii=False, indent=2)
                return True
        return False

    def get_conversation(self, conversation_id):
        """
        获取对话记录
        
        Args:
            conversation_id: 对话ID
            
        Returns:
            dict: 对话数据
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        
        if not os.path.exists(conversation_path):
            raise ValueError(f"对话不存在: {conversation_id}")
        
        with open(conversation_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def get_message_count(self, conversation_id):
        """
        获取对话中的消息总数
        """
        try:
            conversation = self.get_conversation(conversation_id)
            return len(conversation.get('messages', []))
        except:
            return 0

    def get_last_user_message_index(self, conversation_id):
        """
        获取最后一条 user 消息索引，不存在返回 -1
        """
        try:
            messages = self.get_messages(conversation_id)
        except Exception:
            return -1
        for i in range(len(messages) - 1, -1, -1):
            role = str((messages[i] or {}).get("role") or "").strip()
            if role == "user":
                return i
        return -1

    def update_user_message_content(self, conversation_id, message_index, new_content, only_last=True):
        """
        更新一条 user 消息内容。
        - only_last=True 时仅允许修改最后一条 user 消息。
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            return False, "对话不存在"

        try:
            idx = int(message_index)
        except Exception:
            return False, "消息索引无效"

        text = str(new_content or "").strip()
        if not text:
            return False, "消息内容不能为空"

        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)

        messages = conversation_data.get("messages", [])
        if not (0 <= idx < len(messages)):
            return False, "消息不存在"

        msg = messages[idx] if isinstance(messages[idx], dict) else {}
        role = str(msg.get("role") or "").strip()
        if role != "user":
            return False, "仅支持修改用户消息"

        if only_last:
            last_user_index = -1
            for i in range(len(messages) - 1, -1, -1):
                m = messages[i] if isinstance(messages[i], dict) else {}
                if str(m.get("role") or "").strip() == "user":
                    last_user_index = i
                    break
            if idx != last_user_index:
                return False, "仅支持修改最后一条用户消息"

        msg["content"] = text
        msg["timestamp"] = datetime.now().isoformat()
        messages[idx] = msg
        conversation_data["messages"] = messages
        conversation_data["updated_at"] = datetime.now().isoformat()

        with open(conversation_path, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, ensure_ascii=False, indent=2)
        return True, "ok"
    
    def list_conversations(self):
        """
        列出所有对话
        
        Returns:
            list: 对话ID列表，按创建时间倒序排列
        """
        if not os.path.exists(self.base_path):
            return []
        
        conversations = []
        for filename in os.listdir(self.base_path):
            if filename.endswith('.json'):
                conversation_id = filename[:-5]  # 去掉.json后缀
                conversation_path = os.path.join(self.base_path, filename)
                
                with open(conversation_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    longterm = normalize_longterm_state(data.get('longterm', {}))
                    conversations.append({
                        'conversation_id': conversation_id,
                        'title': data.get('title', '未命名对话'),
                        'created_at': data.get('created_at'),
                        'updated_at': data.get('updated_at'),
                        'pin': bool(data.get('pin', False)),
                        'message_count': len(data.get('messages', [])),
                        'conversation_mode': str(data.get('conversation_mode', 'chat') or 'chat'),
                        'longterm_active': bool(longterm.get('active', False)),
                        'longterm_task': str(longterm.get('task', '') or ''),
                        'longterm_step': str(longterm.get('step', '') or '')
                    })
        
        # 置顶优先，其次按更新时间倒序
        conversations.sort(
            key=lambda x: (
                1 if bool(x.get('pin', False)) else 0,
                str(x.get('updated_at') or "")
            ),
            reverse=True
        )
        return conversations

    def set_conversation_pin(self, conversation_id, pin=True):
        """设置对话置顶状态"""
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            raise ValueError(f"对话不存在: {conversation_id}")

        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)

        conversation_data["pin"] = bool(pin)

        with open(conversation_path, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, ensure_ascii=False, indent=2)
    
    def delete_conversation(self, conversation_id):
        """
        删除对话
        
        Args:
            conversation_id: 对话ID
            
        Returns:
            bool: 是否成功删除
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        
        if not os.path.exists(conversation_path):
            return False
        
        os.remove(conversation_path)
        return True
    
    def get_messages(self, conversation_id, limit=None):
        """
        获取对话中的消息
        
        Args:
            conversation_id: 对话ID
            limit: 限制返回的消息数量（从最新开始）
            
        Returns:
            list: 消息列表
        """
        conversation = self.get_conversation(conversation_id)
        messages = conversation.get('messages', [])
        
        if limit:
            messages = messages[-limit:]
        
        return messages

    def get_latest_context_compression(self, conversation_id):
        """
        获取最近一次上下文压缩标记。
        返回结构示例：
        {
          "summary": "...",
          "history_cut_index": 42,
          "created_at": "...",
          "model": "...",
          "provider": "..."
        }
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            return None
        try:
            with open(conversation_path, 'r', encoding='utf-8') as f:
                conversation_data = json.load(f)
            arr = conversation_data.get("context_compressions", [])
            if not isinstance(arr, list) or not arr:
                return None
            last = arr[-1]
            return last if isinstance(last, dict) else None
        except Exception:
            return None

    def append_context_compression(self, conversation_id, marker):
        """
        追加一条上下文压缩标记。
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        if not os.path.exists(conversation_path):
            return False
        if not isinstance(marker, dict):
            return False
        try:
            with open(conversation_path, 'r', encoding='utf-8') as f:
                conversation_data = json.load(f)
            arr = conversation_data.get("context_compressions", [])
            if not isinstance(arr, list):
                arr = []
            item = {
                "summary": str(marker.get("summary", "") or "").strip(),
                "history_cut_index": int(marker.get("history_cut_index", -1) or -1),
                "created_at": str(marker.get("created_at", datetime.now().isoformat()) or datetime.now().isoformat()),
                "model": str(marker.get("model", "") or "").strip(),
                "provider": str(marker.get("provider", "") or "").strip(),
                "trigger_raw_input_tokens": int(marker.get("trigger_raw_input_tokens", 0) or 0),
                "context_window": int(marker.get("context_window", 0) or 0),
            }
            arr.append(item)
            if len(arr) > 40:
                arr = arr[-40:]
            conversation_data["context_compressions"] = arr
            conversation_data["updated_at"] = datetime.now().isoformat()
            with open(conversation_path, 'w', encoding='utf-8') as f:
                json.dump(conversation_data, f, ensure_ascii=False, indent=2)
            return True
        except Exception:
            return False
    
    def set_main_title(self, conversation_id, main_title):
        """
        设置当前这次交流的总结（针对最后一条assistant消息）
        
        Args:
            conversation_id: 对话ID
            main_title: 这次交流的总结
        """
        conversation_path = os.path.join(self.base_path, f"{conversation_id}.json")
        
        if not os.path.exists(conversation_path):
            raise ValueError(f"对话不存在: {conversation_id}")
        
        with open(conversation_path, 'r', encoding='utf-8') as f:
            conversation_data = json.load(f)
        
        # 找到最后一条assistant消息，添加exchange_summary
        for msg in reversed(conversation_data["messages"]):
            if msg["role"] == "assistant":
                msg["exchange_summary"] = main_title
                break
        
        conversation_data["updated_at"] = datetime.now().isoformat()
        
        with open(conversation_path, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, ensure_ascii=False, indent=2)
    
    def get_recent_exchange_summaries(self, conversation_id, limit=5):
        """
        获取最近几次交流的总结
        
        Args:
            conversation_id: 对话ID
            limit: 返回最近N次交流的总结
            
        Returns:
            list: 交流总结列表 [{"user": "...", "summary": "..."}, ...]
        """
        messages = self.get_messages(conversation_id)
        
        summaries = []
        current_pair = {}
        
        for msg in messages:
            if msg["role"] == "user":
                current_pair = {"user": msg["content"][:100]}  # 截取前100字
            elif msg["role"] == "assistant":
                if "exchange_summary" in msg:
                    current_pair["summary"] = msg["exchange_summary"]
                    summaries.append(current_pair)
                    current_pair = {}
        
        return summaries[-limit:] if len(summaries) > limit else summaries
    
    def get_context_length(self, offset=0, conversation_id=None):
        """
        获取前offset个对话的总字符长度
        
        Args:
            offset: 从最新往前数第offset个对话（0=当前，1=上一个）
            conversation_id: 指定对话ID（如果指定则忽略offset，直接获取该对话长度）
            
        Returns:
            int: 字符总长度
        """
        if conversation_id:
            target_conv_id = conversation_id
        else:
            conversations = self.list_conversations()
            if offset >= len(conversations):
                return 0
            target_conv_id = conversations[offset]['conversation_id']
            
        messages = self.get_messages(target_conv_id)
        
        total_length = 0
        for msg in messages:
            total_length += len(msg.get('content', ''))
        
        return total_length
    
    def get_context(self, offset=0, from_pos=0, to_pos=None, conversation_id=None):
        """
        获取前offset个对话从from_pos到to_pos字符的内容
        
        Args:
            offset: 从最新往前数第offset个对话
            from_pos: 起始字符位置
            to_pos: 结束字符位置（None表示到结尾）
            conversation_id: 指定对话ID（如果指定则忽略offset，直接获取该对话内容）
            
        Returns:
            str: 截取的内容
        """
        if conversation_id:
            target_conv_id = conversation_id
        else:
            conversations = self.list_conversations()
            if offset >= len(conversations):
                return ""
            target_conv_id = conversations[offset]['conversation_id']

        messages = self.get_messages(target_conv_id)
        
        # 拼接所有消息
        full_text = ""
        for msg in messages:
            role = msg.get('role', 'unknown')
            content = msg.get('content', '')
            full_text += f"[{role}]: {content}\n\n"
        
        # 截取指定范围
        if to_pos is None:
            return full_text[from_pos:]
        else:
            return full_text[from_pos:to_pos]
    
    def get_context_find_keyword(self, offset=0, keyword="", range_size=10, conversation_id=None):
        """
        在前offset个对话中搜索关键词，返回关键词前后range_size个字符的上下文
        
        Args:
            offset: 从最新往前数第offset个对话
            keyword: 搜索关键词
            range_size: 关键词前后返回的字符数
            conversation_id: 指定对话ID（如果指定则忽略offset，直接在该对话中搜索）
            
        Returns:
            str: 格式化的搜索结果
        """
        if conversation_id:
            target_conv_id = conversation_id
        else:
            conversations = self.list_conversations()
            if offset >= len(conversations):
                return "对话不存在"
            target_conv_id = conversations[offset]['conversation_id']

        messages = self.get_messages(target_conv_id)
        
        results = []
        for msg in messages:
            role = msg.get('role', 'unknown')
            content = msg.get('content', '')
            
            # 查找关键词的所有出现位置
            start = 0
            while True:
                pos = content.find(keyword, start)
                if pos == -1:
                    break
                
                # 提取关键词前后的文本
                context_start = max(0, pos - range_size)
                context_end = min(len(content), pos + len(keyword) + range_size)
                
                before = content[context_start:pos]
                match = content[pos:pos+len(keyword)]
                after = content[pos+len(keyword):context_end]
                
                results.append(f"[{role}]: ...{before}【{match}】{after}...")
                start = pos + 1
        
        if not results:
            return f"未找到关键词: {keyword}"
        
        return "\n".join(results)
    
    def get_main_title(self, conversation_id, offset=0):
        """
        获取指定对话中前offset次交流的总结（从最近往前数）
        
        Args:
            conversation_id: 对话ID
            offset: 从最新往前数第offset次交流（0=当前未完成的交流，1=上一次交流）
            
        Returns:
            str: 交流总结
        """
        messages = self.get_messages(conversation_id)
        
        # 找到所有有exchange_summary的assistant消息
        summaries = []
        for msg in messages:
            if msg["role"] == "assistant" and "exchange_summary" in msg:
                summaries.append(msg["exchange_summary"])
        
        if not summaries:
            return "无交流总结"
        
        # offset=0返回最后一次，offset=1返回倒数第二次
        index = -(offset + 1)
        if abs(index) > len(summaries):
            return "交流不存在"
        
        return summaries[index]


if __name__ == "__main__":
    # 测试代码
    os.chdir("../")
    
    manager = ConversationManager("test_user")
    
    # 创建对话
    conv_id = manager.create_conversation()
    print(f"创建对话: {conv_id}")
    
    # 添加消息
    manager.add_message(conv_id, "user", "你好")
    manager.add_message(conv_id, "assistant", "你好！有什么我可以帮助你的吗？")
    
    # 获取对话
    conversation = manager.get_conversation(conv_id)
    print(f"对话内容: {conversation}")
    
    # 列出所有对话
    conversations = manager.list_conversations()
    print(f"所有对话: {conversations}")
