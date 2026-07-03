import asyncio
import ssl
import json
import aio_pika
import logging

from aio_pika import IncomingMessage

from atm.config_parsers.config_models import RMQConf

logger = logging.getLogger(__name__)

MAX_DELIVERY_ATTEMPTS = 3


class Consumer:
    """
    A RabbitMQ consumer that connects to a queue and processes incoming messages asynchronously.
    Supports requeue-based retry with delivery count tracking and dead-letter routing.
    """

    def __init__(self, callback, queue_name, rmq_config: RMQConf, routing_key):
        self.connection = None
        self.queue = None
        self.channel = None
        self.callback = callback
        self.routing_key = routing_key
        self.rmq_config = rmq_config
        self.queue_name = queue_name
        self.is_connected = False

    async def connect(self):
        """
        Connects to one of the RabbitMQ hosts (tries each in order), sets up the channel,
        and declares queues. Sets up a dead-letter queue for messages that exhaust retries.
        """
        last_error = None
        for host in self.rmq_config.hosts:
            try:
                self.connection = await aio_pika.connect_robust(
                    host=host,
                    port=self.rmq_config.port,
                    login=self.rmq_config.username,
                    password=self.rmq_config.password,
                )
                logger.info(f"Consumer connected to RMQ host: {host}")
                break
            except Exception as e:
                last_error = e
                logger.warning(f"Consumer failed to connect to {host}: {e}")
        else:
            raise ConnectionError(
                f"Could not connect to any RMQ host: {self.rmq_config.hosts}"
            ) from last_error

        self.channel = await self.connection.channel()
        await self.channel.set_qos(prefetch_count=self.rmq_config.prefetchCount)

        # Dead-letter exchange and queue (standalone — always created)
        dlx_name = f"{self.queue_name}_DLX"
        self.dlq_name = f"{self.queue_name}_DLQ"

        self.dlx = await self.channel.declare_exchange(dlx_name, aio_pika.ExchangeType.DIRECT, durable=True)
        dlq = await self.channel.declare_queue(self.dlq_name, durable=True)
        await dlq.bind(self.dlx, routing_key=self.dlq_name)

        # Main queue — declare without DLQ args to be compatible with existing queues.
        # Retry/DLQ routing is handled manually in the consume loop.
        self.queue = await self.channel.declare_queue(
            self.queue_name,
            durable=True,
            auto_delete=False,
        )
        logger.info(f"Consumer connected: queue={self.queue_name}, DLQ={self.dlq_name}")

    def start_consuming(self):
        """
        Starts consuming messages from the queue by running the async consumption loop.
        """
        logger.info(f"Starting consumer for queue: {self.queue_name}")
        asyncio.run(self.__start_consuming())

    async def __start_consuming(self):
        """
        Consumes messages with retry/DLQ logic:
        - On success: ack
        - On failure with retries remaining: nack(requeue=True) — message re-enters the queue
        - On failure with retries exhausted: nack(requeue=False) — message goes to DLQ
        """
        if not self.is_connected:
            await self.connect()
            self.is_connected = True

        if self.queue is None:
            raise Exception("Queue is None. Ensure connect() is called first.")

        async with self.queue.iterator() as queue_iter:
            message: IncomingMessage
            async for message in queue_iter:
                delivery_count = self._get_delivery_count(message)
                msg_preview = message.body[:200].decode("utf-8", errors="replace")

                try:
                    await self.callback(message)
                    await message.ack()
                    logger.debug(f"ACK message (attempt {delivery_count}): {msg_preview}")

                except Exception as e:
                    if delivery_count < MAX_DELIVERY_ATTEMPTS:
                        logger.warning(
                            f"NACK+requeue (attempt {delivery_count}/{MAX_DELIVERY_ATTEMPTS}): "
                            f"{msg_preview} | Error: {e}"
                        )
                        await asyncio.sleep(min(2 ** delivery_count, 30))  # backoff cap 30s
                        await message.nack(requeue=True)
                    else:
                        logger.error(
                            f"Routing to DLQ (exhausted {MAX_DELIVERY_ATTEMPTS} attempts): "
                            f"{msg_preview} | Error: {e}"
                        )
                        # Manually publish to DLX, then ack original message
                        try:
                            await self.dlx.publish(
                                aio_pika.Message(
                                    body=message.body,
                                    headers={**(message.headers or {}), "x-final-error": str(e)},
                                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                                ),
                                routing_key=self.dlq_name,
                            )
                        except Exception as dlq_err:
                            logger.error(f"Failed to publish to DLQ: {dlq_err}")
                        await message.ack()  # remove from main queue either way

    @staticmethod
    def _get_delivery_count(message: IncomingMessage) -> int:
        """
        Extracts the delivery attempt count.
        Uses x-delivery-count header (RabbitMQ quorum queues) or
        x-death header (classic queues with DLX), falling back to 1.
        """
        headers = message.headers or {}

        # Quorum queue style
        if "x-delivery-count" in headers:
            return int(headers["x-delivery-count"]) + 1

        # Classic queue x-death header
        x_death = headers.get("x-death")
        if x_death and isinstance(x_death, list) and len(x_death) > 0:
            return sum(entry.get("count", 0) for entry in x_death) + 1

        return 1