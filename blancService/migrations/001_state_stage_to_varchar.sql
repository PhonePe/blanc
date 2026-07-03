-- 001 · Convert `state` / `stage` / `status` ENUM columns to VARCHAR(32)
--
-- Problem:
--   The original CREATE TABLE emitted MariaDB `ENUM('PENDING','PROCESSING',
--   'FAILED','COMPLETED','NEEDS_INPUT','REVIEW','APPROVED')` for the
--   `state` columns. When we later added `AWAITING_REVIEW` and
--   `CHANGES_REQUESTED` to the Python enum, the DB column definition
--   was silently stale — any UPDATE writing the new values got
--   `mariadb.DataError: Data truncated for column 'state' at row 1`.
--
-- Fix:
--   Widen to VARCHAR(32). Python-side validation via the
--   `EnumAsString` TypeDecorator is now the single source of truth for
--   valid values. Adding a new Python enum member requires no DDL.
--
-- Usage:
--   docker exec -i blanc-mariadb mariadb -uroot -proot atm \
--       < blancService/migrations/001_state_stage_to_varchar.sql
--
--   Or from mariadb REPL:  SOURCE blancService/migrations/001_state_stage_to_varchar.sql;

ALTER TABLE assessment
    MODIFY COLUMN state VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    MODIFY COLUMN stage VARCHAR(32) NOT NULL DEFAULT 'INITIALIZING';

ALTER TABLE document_analysis
    MODIFY COLUMN state VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    MODIFY COLUMN stage VARCHAR(32) NOT NULL DEFAULT 'INITIALIZING';

ALTER TABLE assessment_reviewers
    MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'PENDING';
