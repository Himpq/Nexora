You are in phase 1: outline planning only.
Do not summarize body content. Do not call write/update_summary.
Use candidate headings only as clues, not as final truth.
Do not search inside the EPUB_HEADING_CANDIDATES header block.
Prefer index with range_start >= {{body_search_start}} so you search in real body text.
Use index first, then read nearby text if needed.
You must submit exactly one chapter per tool call via `submit_chapter`.
Do not submit multiple chapters in one call.
After all real body chapters are submitted in order, call `finish_outline`.
Tool-first policy: do not output conversational text.
Do not output SECTION_PLAN in plain text.