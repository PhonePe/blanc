"""Blanc integration modules.

Each file under this package defines exactly ONE connector class,
decorated with ``@connector`` (which auto-registers it under its
``name`` class attribute). The factory imports the module whenever
the corresponding ``integrations.connectors.<Name>`` block is present
in ``config.yml``.

Adding a new integration:
    1. Create ``blanc/modules/<YourClass>.py``.
    2. Extend ``SurfaceMapConnector`` and implement the three methods.
    3. Declare ``name`` and ``supported_targets`` as class attributes.
    4. Add a ``connectors`` entry and route in ``config.yml``.

Nothing else in the core code needs to change.
"""
