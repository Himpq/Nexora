"""Tool definitions for NexoraLearning models."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "createLecture",
            "description": "Create a new lecture container in NexoraLearning.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Lecture title."},
                    "description": {"type": "string", "description": "Optional lecture description."},
                    "category": {"type": "string", "description": "Optional lecture category."},
                    "status": {"type": "string", "description": "Lecture status, default is draft."},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "createBook",
            "description": "Create a new book under a lecture.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lecture_id": {"type": "string", "description": "Target lecture id."},
                    "title": {"type": "string", "description": "Book title."},
                    "description": {"type": "string", "description": "Optional book description."},
                    "source_type": {"type": "string", "description": "Source type, default is text."},
                    "cover_path": {"type": "string", "description": "Optional local cover path."},
                },
                "required": ["lecture_id", "title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "uploadBookText",
            "description": "Upload or replace the plain text content of a book and optionally auto-vectorize it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lecture_id": {"type": "string", "description": "Target lecture id."},
                    "book_id": {"type": "string", "description": "Target book id."},
                    "content": {"type": "string", "description": "UTF-8 text content."},
                    "filename": {"type": "string", "description": "Logical source filename, default content.txt."},
                    "auto_vectorize": {"type": "boolean", "description": "Whether to queue vectorization immediately."},
                },
                "required": ["lecture_id", "book_id", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "getLecture",
            "description": "Fetch lecture metadata and its book list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lecture_id": {"type": "string", "description": "Target lecture id."},
                },
                "required": ["lecture_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "getBook",
            "description": "Fetch metadata for a book.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lecture_id": {"type": "string", "description": "Target lecture id."},
                    "book_id": {"type": "string", "description": "Target book id."},
                },
                "required": ["lecture_id", "book_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "getBookText",
            "description": "Read the stored plain text content of a book.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lecture_id": {"type": "string", "description": "Target lecture id."},
                    "book_id": {"type": "string", "description": "Target book id."},
                },
                "required": ["lecture_id", "book_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "triggerBookVectorization",
            "description": "Trigger NexoraDB vectorization for a book.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lecture_id": {"type": "string", "description": "Target lecture id."},
                    "book_id": {"type": "string", "description": "Target book id."},
                    "force": {"type": "boolean", "description": "Force re-vectorization."},
                    "async": {"type": "boolean", "description": "Run in background, default true."},
                },
                "required": ["lecture_id", "book_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "vectorSearch",
            "description": "Search vectorized lecture chunks (local fallback over chunks when needed).",
            "parameters": {
                "type": "object",
                "properties": {
                    "lecture_id": {"type": "string", "description": "Target lecture id."},
                    "query": {"type": "string", "description": "Search query text."},
                    "book_id": {"type": "string", "description": "Optional book id filter."},
                    "top_k": {"type": "integer", "description": "Maximum results to return. Default 5."},
                },
                "required": ["lecture_id", "query"],
            },
        },
    },
]

Tools = TOOLS
