# Packages

This directory contains shared building blocks used by the supported Product
Suite apps and services:

- `contracts`
- `db`
- `sdk`
- `ui`
- `ui-chat`
- `ui-meeting`
- `ui-canvas`
- `ui-planning`
- `ui-charting`

The UI packages remain shell-agnostic. Supported Vite apps and backend services
own their runtime data loading, routing, permissions, and orchestration.
`apps/roadmap-web` is retained unsupported source and does not own current
product behavior.
