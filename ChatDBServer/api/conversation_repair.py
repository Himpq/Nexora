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


def _repair_json_text(text: str) -> str:
    out: List[str] = []
    in_string = False
    escape = False
    n = len(text)
    i = 0

    while i < n:
        ch = text[i]
        if not in_string:
            out.append('\ufffd' if '\udc80' <= ch <= '\udcff' else ch)
            if ch == '"':
                in_string = True
            i += 1
            continue

        if escape:
            out.append(ch)
            escape = False
            i += 1
            continue

        if ch == '\\':
            out.append(ch)
            escape = True
            i += 1
            continue

        if ch == '"':
            j = i + 1
            while j < n and text[j] in ' \t\r\n':
                j += 1
            nextch = text[j] if j < n else ''
            if nextch in ',:}]' or nextch == '':
                out.append(ch)
                in_string = False
            else:
                out.append('\\"')
            i += 1
            continue

        out.append('\ufffd' if '\udc80' <= ch <= '\udcff' else ch)
        i += 1

    return ''.join(out)


def _extract_balanced_fragment(text: str, start: int, opening: str, closing: str) -> Optional[str]:
    if start < 0 or start >= len(text) or text[start] != opening:
        return None

    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        ch = text[idx]
        if in_string:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == opening:
            depth += 1
        elif ch == closing:
            depth -= 1
            if depth == 0:
                return text[start:idx + 1]

    return None


def _extract_json_value(text: str, field_name: str, default: Any = None) -> Any:
    marker = f'"{field_name}":'
    start = text.find(marker)
    if start < 0:
        return default

    value_start = start + len(marker)
    while value_start < len(text) and text[value_start] in ' \t\r\n':
        value_start += 1

    if value_start >= len(text):
        return default

    if text[value_start] == '"':
        end = value_start + 1
        escape = False
        while end < len(text):
            ch = text[end]
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == '"':
                break
            end += 1
        if end >= len(text):
            return default
        return decode_loose_json_string(text[value_start + 1:end])

    if text[value_start] in '{[':
        opening = text[value_start]
        fragment = _extract_balanced_fragment(text, value_start, opening, '}' if opening == '{' else ']')
        if fragment is not None:
            return fragment
        return default

    end = value_start
    while end < len(text) and text[end] not in ',}]\r\n':
        end += 1
    raw_value = text[value_start:end].strip()
    if raw_value in ('true', 'false'):
        return raw_value == 'true'
    if raw_value == 'null':
        return None
    return raw_value if raw_value else default


def _clean_surrogates(value: Any) -> Any:
    if isinstance(value, str):
        return ''.join('\ufffd' if 0xD800 <= ord(ch) <= 0xDFFF else ch for ch in value)
    if isinstance(value, list):
        return [_clean_surrogates(item) for item in value]
    if isinstance(value, dict):
        return {key: _clean_surrogates(item) for key, item in value.items()}
    return value


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

    array_start = text.find('[', start)
    if array_start < 0:
        return []

    fragment = _extract_balanced_fragment(text, array_start, '[', ']')
    if not fragment:
        return []

    try:
        parsed = json.loads(_repair_json_text(fragment))
    except Exception:
        return []

    return parsed if isinstance(parsed, list) else []


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


def _parse_message_chunk(chunk: str) -> Dict[str, Any]:
    repaired = _repair_json_text(chunk)
    try:
        parsed = json.loads(repaired)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    item: Dict[str, Any] = {
        'role': _extract_json_value(chunk, 'role', 'assistant') or 'assistant',
        'content': _extract_json_value(chunk, 'content', '') or '',
        'timestamp': _extract_json_value(chunk, 'timestamp', '') or '',
    }

    model_name = _extract_json_value(chunk, 'model_name', '')
    if isinstance(model_name, str) and model_name:
        item['model_name'] = model_name

    exchange_summary = _extract_json_value(chunk, 'exchange_summary', '')
    if isinstance(exchange_summary, str) and exchange_summary:
        item['exchange_summary'] = exchange_summary

    metadata_start = chunk.find('"metadata":')
    if metadata_start >= 0:
        fragment_start = chunk.find('{', metadata_start)
        if fragment_start >= 0:
            metadata_fragment = _extract_balanced_fragment(chunk, fragment_start, '{', '}')
            metadata: Dict[str, Any] = {}
            if metadata_fragment:
                parsed_metadata = None
                try:
                    parsed_metadata = json.loads(_repair_json_text(metadata_fragment))
                except Exception:
                    parsed_metadata = None
                if isinstance(parsed_metadata, dict):
                    metadata = parsed_metadata
                else:
                    meta_model_name = _extract_json_value(metadata_fragment, 'model_name', '')
                    if isinstance(meta_model_name, str) and meta_model_name:
                        metadata['model_name'] = meta_model_name

                    search_enabled = _extract_json_value(metadata_fragment, 'search_enabled', None)
                    if isinstance(search_enabled, bool):
                        metadata['search_enabled'] = search_enabled

                    reasoning_content = _extract_json_value(metadata_fragment, 'reasoning_content', '')
                    if isinstance(reasoning_content, str) and reasoning_content:
                        metadata['reasoning_content'] = reasoning_content

                    for subkey in ('request_debug', 'io_tokens'):
                        raw_value = _extract_json_value(metadata_fragment, subkey, None)
                        if isinstance(raw_value, str):
                            try:
                                parsed_value = json.loads(_repair_json_text(raw_value))
                            except Exception:
                                parsed_value = None
                            if isinstance(parsed_value, dict):
                                metadata[subkey] = parsed_value

            if metadata:
                item['metadata'] = metadata

    return item


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
        chunk = body[pos:next_pos].rstrip(',\n\r \t')
        messages.append(_parse_message_chunk(chunk))

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

    repaired = _clean_surrogates(repaired)

    if backup:
        backup_path = f'{file_path}.bak'
        if not os.path.exists(backup_path):
            shutil.copyfile(file_path, backup_path)

    with open(file_path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(repaired, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    return repaired
