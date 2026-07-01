__all__ = ["workspace_bp"]


def __getattr__(name):
    if name == "workspace_bp":
        from .routes import workspace_bp

        return workspace_bp

    raise AttributeError(name)
