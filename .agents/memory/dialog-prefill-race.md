---
name: Dialog prefill from lazily-enabled query cache
description: Dialogs that prefill fields from another React Query cache race the query load; backfill via effect.
---

Web dialogs on this project often prefill form fields (price, currency, etc.) by reading another query's cached data at open time. If that query is lazily `enabled` (e.g. only when the dialog opens), the cache is empty on first open and the prefill silently fails — the field shows only its placeholder, which e2e screenshots can mistake for a value.

**Why:** Caught by e2e on the dispatch-invoice dialog: price stayed empty because the contracts query loaded after `openDialog` read the cache.

**How to apply:** For any open-dialog prefill sourced from a query, (1) also enable the query on the tab/page that hosts the trigger button, and (2) add a `useEffect` keyed on the query data that backfills still-empty fields after load. Never rely solely on reading the cache inside the click handler.
