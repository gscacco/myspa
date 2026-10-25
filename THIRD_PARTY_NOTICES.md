# Third-Party Notices

Loom redistributes the following third-party software inside the generated `dist/loom.html` artifact.

## Scittle 0.8.33

- Copyright (c) 2021-2022 Michiel Borkent
- License: Eclipse Public License 1.0 (EPL-1.0), available in `licenses/EPL-1.0.txt`
- Upstream source: <https://github.com/babashka/scittle>
- Bundled file: `node_modules/scittle/dist/scittle.js`
- SHA-256: `e04a33ff90947057772f42e683314e9c9f8671ebb922398208b4ad1c76991373`

Scittle provides the in-browser ClojureScript interpreter used by Loom. The generated Loom artifact embeds the unmodified Scittle distribution and includes this attribution in a JavaScript comment.

## JetBrains Mono 5.3.0 (Fontsource build)

- Copyright 2020 The JetBrains Mono Project Authors
- License: SIL Open Font License 1.1 (OFL-1.1), available in `licenses/OFL-1.1.txt`
- Upstream source: <https://github.com/JetBrains/JetBrainsMono>
- Package: `@fontsource/jetbrains-mono` 5.3.0
- Bundled files and SHA-256:
  - `loom/fonts/jetbrains-mono-latin-400-normal.woff2`: `14425ba9c695763c1547f48a206b7aa60350a33ae23de09f0407877f3fcd89eb`
  - `loom/fonts/jetbrains-mono-latin-400-italic.woff2`: `87ddac4a62229787528cf4ac3fa58137b62a9aec364c44fc0f40470bcda9efba`
  - `loom/fonts/jetbrains-mono-latin-600-normal.woff2`: `400c6bfda18d5d14acad1c15d6dcb9f8e13c015e7286317e0b9a482539bef147`

The generated Loom artifact embeds these unmodified WOFF2 files as data URLs so the programming font works offline. This attribution is also included in a JavaScript comment.
