import threading
import logging

from blanc.config_parsers.settings import get_settings
from blanc.queue.cancelable_thread_pool_exectuor import CancelableThreadPoolExecutor
from blanc.queue.consumer import Consumer
from blanc.queue.message_processing import callback
from blanc.util.managed_entity import ManagedEntity

config = get_settings()


class ThreadedConsumerWrapper(ManagedEntity):
    """
    A wrapper that manages multiple threaded consumers 
    using a thread pool to handle concurrent message processing.
    """

    def __init__(self):
        """
        Initializes the ThreadedConsumerWrapper with RabbitMQ configuration, 
        strategy configuration, and a list to hold thread pools.
        """
        self.rmq_config = config.rmqConfig
        # self.strategyConfig = config.strategyConfig
        self.poolList = []

    def start(self):
        """
        Starts the consumers by creating a thread pool and submitting consumer tasks 
        for each queue in the configuration.
        """
        try:
            logging.debug(f"Starting Thread for consumer tasks, 'thread': {threading.current_thread().ident}")
            pool = CancelableThreadPoolExecutor(max_workers=100, thread_name_prefix="consumer")

            for queue in self.rmq_config.queues:
                logging.debug(f"Creating thread pool for queue: {queue}")
                for _ in range(queue.concurrency):
                    logging.debug(f"Creating consumer task for queue: {queue}")
                    consumer = Consumer(queue_name=queue.name,
                                        callback=callback, rmq_config=self.rmq_config, routing_key=queue.name)
                    logging.debug(f"Starting consumer task for queue: {queue}")
                    self.poolList.append(pool)
                    pool.submit(consumer.start_consuming)

        except Exception as e:
            logging.error(e)
            raise

    def stop(self):
        """
        Stops all consumers by shutting down each thread pool.
        """
        for pool in self.poolList:
            pool.shutdown(wait=False, cancel_futures=True)