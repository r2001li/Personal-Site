# Ryan's Personal Site & AI Portfolio

An interactive personal portfolio site featuring an in-browser local AI assistant powered by **Qwen3.5-2B** running via [Transformers.js](https://huggingface.co/docs/transformers.js) and ONNX Runtime Web.

## Overview

- **100% Client-Side Inference:** The AI model executes directly in the user's browser using WebGPU with a WebAssembly/CPU fallback. No chat data or prompts ever leave the client.
- **Web Worker Architecture:** Inference and model streaming execute inside a dedicated Web Worker to keep the UI thread responsive.
- **Persistent Chat History:** Chat messages are validated and cached locally in `localStorage` up to a bounded context window.
- **Responsive & Accessible Design:** Light and dark mode support conforming to system preferences, keyboard navigation, and touch-friendly controls.

## Tech Stack

- **Framework:** [React 19](https://react.dev)
- **Language:** [TypeScript](https://www.typescriptlang.org)
- **Bundler:** [Vite](https://vite.dev)
- **Runtime & Package Manager:** [Bun](https://bun.sh)
- **Model:** `onnx-community/Qwen3.5-2B-ONNX-OPT`
- **Linting & Testing:** [Oxlint](https://oxc.rs), [Vitest](https://vitest.dev)
- **Analytics:** [@vercel/analytics](https://vercel.com/analytics)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- A modern browser supporting WebGPU or WebAssembly SIMD

### Installation

```bash
bun install
```

### Development

Start the local dev server:

```bash
bun run dev
```

### Testing & Linting

Run unit tests:

```bash
bun test
```

Run linter:

```bash
bun run lint
```

### Production Build

Typecheck and build the bundle:

```bash
bun run build
```

Preview the production build locally:

```bash
bun run preview
```
