# Project structure

## Layers {#layers}

UI → view model → domain service → storage adapter. Dependencies point one way, left to right.

## Extension point {#extension}

New features attach to the domain service, never directly to the UI.
