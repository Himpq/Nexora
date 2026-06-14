"""
Persistent event loop thread for Crawlee crawlers.

Crawlee/Playwright bind asyncio locks to the event loop at creation time.
Using asyncio.run() creates a new loop each time, causing "Lock is bound to
a different event loop" errors. This module provides a single persistent
event loop running in a background thread that all crawlers share.
"""

import asyncio
import threading


class _CrawleeLoop:
    """Background thread running a persistent asyncio event loop."""

    def __init__(self):
        self._loop = None
        self._thread = None
        self._started = threading.Event()

    def _run_forever(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._started.set()
        self._loop.run_forever()

    def start(self):
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run_forever, daemon=True)
        self._thread.start()
        self._started.wait()

    def run_coroutine(self, coro):
        """Run a coroutine on the persistent event loop and return the result.

        This blocks the calling thread until the coroutine completes.
        """
        if self._loop is None:
            self.start()
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result()


# Module-level singleton
_manager = _CrawleeLoop()


def run_crawlee(coro):
    """Run an async Crawlee coroutine on the persistent event loop."""
    _manager.start()
    return _manager.run_coroutine(coro)
