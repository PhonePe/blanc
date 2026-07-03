import logging
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine.url import make_url
from sqlalchemy.exc import OperationalError, PendingRollbackError, ProgrammingError, SQLAlchemyError
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from atm.config_parsers.settings import get_settings

log = logging.getLogger(__name__)

config = get_settings()

MARIADB_DATABASE_URL = config.dbConfig.mariadbConnectionString


def _ensure_database_exists(url: str) -> None:
    """Create the target schema if it doesn't exist yet.

    On a fresh MariaDB install you get the server + auth but no
    application schema — the app then fails to connect with
    ``Unknown database 'atm'``. This helper connects with the schema
    name stripped from the URL, runs ``CREATE DATABASE IF NOT EXISTS``,
    and returns. Idempotent — safe to run on every startup.
    """
    parsed = make_url(url)
    dbname = parsed.database
    if not dbname:
        # No database name in the URL — nothing to create.
        return

    # Drop the database name so we can log in with just the credentials.
    # NB: `url.set(database=None)` treats None as "unchanged" in
    # SQLAlchemy 2.x — you have to pass an empty string to actually
    # clear it. This tripped me up on the first pass.
    server_url = parsed.set(database="")
    bootstrap_engine = create_engine(server_url, pool_pre_ping=True)
    try:
        with bootstrap_engine.connect() as conn:
            # Backtick-quote the identifier — parametrised statements
            # can't be used for DDL identifiers in most drivers.
            safe_name = dbname.replace("`", "``")
            conn.execute(text(
                f"CREATE DATABASE IF NOT EXISTS `{safe_name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            ))
            conn.commit()
        log.info("Ensured database %r exists", dbname)
    except (OperationalError, ProgrammingError) as e:
        # A permission-denied error here means the connecting user
        # can't CREATE — surface it clearly instead of failing later.
        log.error(
            "Could not auto-create database %r. Either create it "
            "manually (mariadb -uroot -p …), or grant the connecting "
            "user CREATE privileges. Original error: %s",
            dbname, e,
        )
        raise
    finally:
        bootstrap_engine.dispose()


_ensure_database_exists(MARIADB_DATABASE_URL)


engine = create_engine(
    MARIADB_DATABASE_URL,
    pool_size=config.dbConfig.poolSize,
    pool_recycle=config.dbConfig.poolRecycle,
    max_overflow=config.dbConfig.maxOverflow,
    pool_pre_ping=True,
)

# expire_on_commit=False keeps ORM instances usable after a successful
# commit — otherwise every attribute access re-hits the DB, which is
# both slow and pointless for the "commit then return the row's fields"
# pattern our routers use.
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    bind=engine,
)

Base = declarative_base()


def _log_full_chain(exc: BaseException) -> None:
    """Walk the exception chain and log every `__cause__`.

    Without this, SQLAlchemy's `PendingRollbackError` masks the *original*
    driver error ("mariadb: column x too long", "duplicate entry", etc.)
    behind its own "Session's transaction has been rolled back" message.
    """
    seen: set[int] = set()
    cur = exc
    depth = 0
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        log.error("  [chain depth %d] %s: %s", depth, type(cur).__name__, cur)
        cur = cur.__cause__ or cur.__context__
        depth += 1


def get_db():
    """FastAPI dependency that yields a request-scoped session.

    Rolls back on any exception raised inside the endpoint AND on a
    `PendingRollbackError` state left over from a prior failed flush
    within the same request. Full exception chains are logged so the
    root cause (usually the mariadb driver error) is visible.
    """
    db = SessionLocal()
    try:
        yield db
    except PendingRollbackError as e:
        log.error("PendingRollbackError — DB transaction was already invalidated:")
        _log_full_chain(e)
        db.rollback()
        raise
    except SQLAlchemyError as e:
        log.error("SQLAlchemyError during request:")
        _log_full_chain(e)
        log.exception("Traceback:")
        db.rollback()
        raise
    except Exception as e:
        log.exception("Non-SQL exception during request: %s", e)
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def get_db_session():
    """Same shape as `get_db` but usable as a plain context manager
    outside FastAPI (background tasks, CLI scripts, tests).
    """
    db = SessionLocal()
    try:
        yield db
    except PendingRollbackError as e:
        log.error("PendingRollbackError in background session:")
        _log_full_chain(e)
        db.rollback()
        raise
    except SQLAlchemyError as e:
        log.error("SQLAlchemyError in background session:")
        _log_full_chain(e)
        log.exception("Traceback:")
        db.rollback()
        raise
    except Exception as e:
        log.exception("Non-SQL exception in background session: %s", e)
        db.rollback()
        raise
    finally:
        db.close()
