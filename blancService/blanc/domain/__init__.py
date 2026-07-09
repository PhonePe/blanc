"""Domain-level primitives — enums, constants, value objects.

Nothing in this package imports from :mod:`blanc.schemas`,
:mod:`blanc.db_models`, or :mod:`blanc.routers`. It sits at the bottom
of the dependency graph so everyone can import from it without cycles.
"""
