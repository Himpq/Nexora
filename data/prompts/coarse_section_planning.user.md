Course: {{lecture_name}}
Book: {{book_name}}
Body search start offset: {{body_search_start}}
Heading candidates:
{{candidate_block}}
Build an outline plan by locating real body positions one chapter at a time.
Do not use matches from the header candidates block.
Prefer index(keyword, range_start=body_search_start, range_end=end_of_book).
Submit only the current confirmed chapter using submit_chapter(chapter_name, start, end).
Each submitted chapter must be chapter-level, sorted by start, non-overlapping, and avoid tiny fragments.
When all chapters have been submitted, call finish_outline().