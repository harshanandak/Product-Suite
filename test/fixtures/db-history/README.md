# Historical migration fixtures

`bootstrap-probe.json` is the deterministic contract for the live empty
PostgreSQL probe. The untouched chain must fail at `0000` with PostgreSQL
`42P01` (`public.tenants`); the repaired chain defers exactly five external
foreign keys. A missing local PostgreSQL 17 + pgvector service is an
INCOMPLETE live probe, never a passing result.
