import json
import os
import re
import shutil
from typing import Any, Dict, List, Optional


_MESSAGE_START_RE = re.compile(r'\n\s*\{\n\s*"role": ')
_CONTENT_END_RE = re.compile(r'",\n\s+"[A-Za-z_]+":')
_UNICODE_ESCAPE_RE = re.compile(r'\\u([0-9a-fA-F]{4})')


def _decode_unicode_escapes(value: str) -> str:
    def _repl(match: re.Match[str]) -> str:
        try:
            return chr(int(match.group(1), 16))
        except Exception:
            return match.group(0)

    return _UNICODE_ESCAPE_RE.sub(_repl, value)


def decode_loose_json_string(raw: str) -> str:
    src = str(raw or '').strip()
    if not src:
        return ''

    sanitized = src
    sanitized = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', sanitized)
    sanitized = re.sub(r'(?<!\\)"', r'\"', sanitized)

    try:
        return json.loads(f'"{sanitized}"')
    except Exception:
        fallback = sanitized
        fallback = fallback.replace(r'\"', '"')
        fallback = fallback.replace(r'\/', '/')
        fallback = fallback.replace(r'\n', '\n')
        fallback = fallback.replace(r'\r', '\r')
        fallback = fallback.replace(r'\t', '\t')
        fallback = _decode_unicode_escapes(fallback)
        return fallback


def _extract_json_string_field(text: str, field_name: str, default: str = '') -> str:
    marker = f'"{field_name}": "'
    start = text.find(marker)
    if start < 0:
        return default
    start += len(marker)
    end = text.find('",', start)
    if end < 0:
        end = text.find('"\n', start)
    if end < 0:
        return default
    return decode_loose_json_string(text[start:end])


def _extract_bool_field(text: str, field_name: str, default: bool = False) -> bool:
    match = re.search(rf'"{re.escape(field_name)}"\s*:\s*(true|false)', text)
    if not match:
        return default
    return match.group(1).lower() == 'true'


def _extract_context_compressions(text: str) -> List[Dict[str, Any]]:
    start = text.find('"context_compressions": [')
    if start < 0:
        return []
    candidate = '{' + text[start:]
    try:
        parsed = json.loads(candidate)
        arr = parsed.get('context_compressions', [])
        return arr if isinstance(arr, list) else []
    except Exception:
        return []


def _find_content_end(chunk: str, content_start: int) -> int:
    sub = chunk[content_start:]
    marker = _CONTENT_END_RE.search(sub)
    if marker:
        return content_start + marker.start()

    fallback_markers = [
        '",\n    }',
        '",\n  }',
        '",\n      }',
    ]
    positions = []
    for item in fallback_markers:
        pos = chunk.find(item, content_start)
        if pos >= 0:
            positions.append(pos)
    return min(positions) if positions else len(chunk)


def _fill_missing_timestamps(messages: List[Dict[str, Any]]) -> None:
    next_known: Optional[str] = None
    for idx in range(len(messages) - 1, -1, -1):
        ts = str(messages[idx].get('timestamp') or '').strip()
        if ts:
            next_known = ts
        elif next_known:
            messages[idx]['timestamp'] = next_known

    prev_known: Optional[str] = None
    for item in messages:
        ts = str(item.get('timestamp') or '').strip()
        if ts:
            prev_known = ts
        elif prev_known:
            item['timestamp'] = prev_known


def _repair_messages(text: str) -> List[Dict[str, Any]]:
    start = text.find('"messages": [')
    if start < 0:
        return []
    end = text.find('"context_compressions": [', start)
    if end < 0:
        end = len(text)
    body = text[start:end]

    positions = [match.start() for match in _MESSAGE_START_RE.finditer(body)]
    messages: List[Dict[str, Any]] = []

    for idx, pos in enumerate(positions):
        next_pos = positions[idx + 1] if idx + 1 < len(positions) else len(body)
        chunk = body[pos:next_pos]

        role_match = re.search(r'"role":\s*"([^"]+)"', chunk)
        if not role_match:
            continue
        role = role_match.group(1).strip()
        if not role:
            continue

        content = ''
        content_marker = re.search(r'"content":\s*"', chunk)
        if content_marker:
            content_start = content_marker.end()
            content_end = _find_content_end(chunk, content_start)
            raw_content = chunk[content_start:content_end]
            content = decode_loose_json_string(raw_content)

        timestamp_match = re.search(r'"timestamp":\s*"([^"]+)"', chunk)
        timestamp = timestamp_match.group(1).strip() if timestamp_match else ''

        item: Dict[str, Any] = {
            'role': role,
            'content': content,
            'timestamp': timestamp,
        }

        model_match = re.search(r'"model_name":\s*"([^"]+)"', chunk)
        if model_match:
            item['model_name'] = decode_loose_json_string(model_match.group(1))

        messages.append(item)

    _fill_missing_timestamps(messages)
    return messages


def recover_conversation_bytes(raw: bytes, source_path: str = '') -> Optional[Dict[str, Any]]:
    if not raw:
        return None

    for encoding in ('utf-8', 'utf-8-sig'):
        try:
            parsed = json.loads(raw.decode(encoding))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue

    text = raw.decode('utf-8', errors='ignore')
    if '"conversation_id"' not in text or '"messages"' not in text:
        return None

    repaired: Dict[str, Any] = {
        'conversation_id': _extract_json_string_field(text, 'conversation_id', ''),
        'title': _extract_json_string_field(text, 'title', 'Recovered Conversation'),
        'created_at': _extract_json_string_field(text, 'created_at', ''),
        'updated_at': _extract_json_string_field(text, 'updated_at', ''),
        'pin': _extract_bool_field(text, 'pin', False),
        'messages': _repair_messages(text),
    }

    context_compressions = _extract_context_compressions(text)
    if context_compressions:
        repaired['context_compressions'] = context_compressions

    last_response_id = _extract_json_string_field(text, 'last_volc_response_id', '')
    if last_response_id:
        repaired['last_volc_response_id'] = last_response_id

    last_model_used = _extract_json_string_field(text, 'last_model_used', '')
    if last_model_used:
        repaired['last_model_used'] = last_model_used

    if not repaired['conversation_id'] or not repaired['messages']:
        return None
    return repaired


def repair_conversation_file(file_path: str, backup: bool = True) -> Optional[Dict[str, Any]]:
    with open(file_path, 'rb') as f:
        raw = f.read()

    repaired = recover_conversation_bytes(raw, source_path=file_path)
    if not isinstance(repaired, dict):
        return None

    if backup:
        backup_path = f'{file_path}.bak'
        if not os.path.exists(backup_path):
            shutil.copyfile(file_path, backup_path)

    with open(file_path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(repaired, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    return repaired
