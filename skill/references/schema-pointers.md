# UIC Schema References

These JSON Schemas define the machine-readable artifacts produced by UIC.

## Schemas

- **Inventory**: `tool/schemas/inventory.schema.json` — Discovery output format
- **Contract**: `tool/schemas/contract.schema.json` — Coverage contract format
- **Report**: `tool/schemas/report.schema.json` — Coverage gate report format

## Key Concepts

### Surface
A checkpointed UI state: route + persona + viewport + state. Each surface has
expectations (required elements, no console errors) and a policy (required/blocking/warning).

### Flow
A user journey across one or more pages. Flows are sequences of steps
(navigate, fill, click, verify) that test end-to-end behavior.

### Invariant
A cross-cutting requirement that applies to all or most surfaces
(e.g., no console errors, auth redirect for protected routes).

### Drift
When the current UI inventory doesn't match the contract. Can be:
- New routes/elements not in the contract
- Removed routes/elements still in the contract
- Changed element counts on existing routes
