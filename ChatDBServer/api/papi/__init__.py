__all__ = ['papi_bp']


def __getattr__(name):
    if name == 'papi_bp':
        from .routes import papi_bp
        return papi_bp
    raise AttributeError(name)
