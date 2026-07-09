from concurrent.futures import ThreadPoolExecutor, Future
from typing import List


class CancelableThreadPoolExecutor(ThreadPoolExecutor):
    """
    A ThreadPoolExecutor that allows cancellation of all running and pending futures.
    """

    def __init__(self, **kwargs):
        """
        Initializes the CancelableThreadPoolExecutor and maintains a list of submitted futures.
        """
        self.futures: List[Future] = []
        super().__init__(**kwargs)

    def submit(self, func, **kwargs):
        """
        Submits a function to the executor and tracks its future for potential cancellation.
        """
        future = super().submit(func, **kwargs)
        self.futures.append(future)
        return future

    def clean_up(self):
        """
        Shuts down the executor immediately, canceling all pending futures.
        """
        self.shutdown(wait=False, cancel_futures=True)

