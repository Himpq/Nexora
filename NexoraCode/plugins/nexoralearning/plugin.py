"""NexoraLearning plugin entry point."""

from .tools import ListCoursesTool


def register(api):
    api.register_tool(ListCoursesTool(api))
