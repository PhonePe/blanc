import ssl
import asyncio
import aio_pika
import logging

from aio_pika import Message

from blanc.config_parsers.settings import get_settings
from blanc.config_parsers.config_models import RMQConf
from blanc.queue.rmq_message import RMQMessage

logger = logging.getLogger(__name__)

QUEUE_NAME = "BLANC"


class Producer:
    """
    A RabbitMQ producer that connects to a queue and publishes messages asynchronously.
    """

    def __init__(self, rmq_config: RMQConf, routing_key: str):
        self.routing_key = routing_key
        self.rmq_config = rmq_config
        self.connected = False

    async def _connect(self):
        """
        Tries each RMQ host in order until one connects.
        Uses non-robust connection with timeout so publish_task fails fast when all hosts are down.
        """
        last_error = None
        for host in self.rmq_config.hosts:
            try:
                self.connection = await aio_pika.connect(
                    host=host,
                    port=self.rmq_config.port,
                    login=self.rmq_config.username,
                    password=self.rmq_config.password,
                    timeout=5,
                )
                logger.info(f"Producer connected to RMQ host: {host}")
                break
            except Exception as e:
                last_error = e
                logger.warning(f"Producer failed to connect to {host}: {e}")
        else:
            raise ConnectionError(
                f"Could not connect to any RMQ host: {self.rmq_config.hosts}"
            ) from last_error

        self.channel = await self.connection.channel()
        self.exchange = await self.channel.declare_exchange('direct', auto_delete=False)
        self.queue = await self.channel.declare_queue(self.routing_key, durable=True, auto_delete=False)
        await self.queue.bind(exchange=self.exchange, routing_key=self.routing_key)

    async def publish(self, msg: Message):
        """
        Publishes a message to the RabbitMQ exchange with the specified routing key.
        """
        if not self.connected:
            await self._connect()
            self.connected = True
        await self.exchange.publish(msg, routing_key=self.routing_key)


# Initialize RabbitMQ configuration and producers
rmqConfig = get_settings().rmqConfig
queuesList = rmqConfig.queues
queueMap = {}

for queue in queuesList:
    producer = Producer(rmqConfig, routing_key=queue.name)
    queueMap[queue.name] = producer

logging.debug("Queue MAP - %s", queueMap)

def get_producer(queue_name):
    """
    Retrieves a producer instance from the queue map based on the provided queue name.
    """
    return queueMap.get(queue_name)


async def publish_task(rmq_message: RMQMessage, queue_name: str = QUEUE_NAME):
    """
    Publish an RMQMessage to the queue.
    If RabbitMQ is unavailable, falls back to in-process background execution
    so the system remains functional during development or outages.
    """
    producer = get_producer(queue_name)
    if not producer:
        raise RuntimeError(f"No producer found for queue: {queue_name}")

    try:
        msg = Message(
            body=rmq_message.to_bytes(),
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        )
        await producer.publish(msg)
        logger.info(
            f"[{rmq_message.assessment_id}] Published {rmq_message.task_type} to {queue_name}"
        )
    except Exception as e:
        logger.warning(
            f"[{rmq_message.assessment_id}] RMQ publish failed ({type(e).__name__}: {e}), "
            f"falling back to in-process execution"
        )
        # Reset connection state so next call retries RMQ
        producer.connected = False
        asyncio.create_task(_run_fallback(rmq_message))


async def _run_fallback(rmq_message: RMQMessage):
    """Execute task directly in-process when RMQ is unavailable."""
    from blanc.queue.message_processing import dispatch_task
    try:
        await dispatch_task(rmq_message)
    except Exception as e:
        logger.error(
            f"[{rmq_message.assessment_id}] In-process fallback failed for {rmq_message.task_type}: {e}"
        )
