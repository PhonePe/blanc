from atm.config_parsers.settings import get_settings
import logging.config
import logging

class LoggingConfig(object):

    @staticmethod    
    def configure_logging():
        log_config = get_settings().logging
        logging.config.dictConfig(log_config)
        logging.info(f" Enabled logging config")

    
