# `@product-suite/contracts`

This package holds the shared wire-contract nucleus for Product Suite.

PR4 intentionally keeps the scope narrow:

- identity scope
- conversation
- meeting core
- canvas core

It exists so both JS apps can import the same shared contract helpers while the Python backend validates against the same canonical artifacts from disk.
