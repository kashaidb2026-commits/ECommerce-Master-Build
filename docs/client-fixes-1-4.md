# Client fixes 1–4

This branch stages the requested Ka.Sha catalog and Custom Studio fixes one at a time.

## Point 1
Newly added products are returned newest-first by `createdAt`, with product ID as a deterministic tie-breaker. Existing filters and product response formatting are unchanged.
