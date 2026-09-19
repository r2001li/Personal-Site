/// <reference lib="webworker" />

import {
  env,
  pipeline,
  TextStreamer,
  InterruptableStoppingCriteria,
} from '@huggingface/transformers'
import type { Message, ProgressInfo, TextGenerationPipeline } from '@huggingface/transformers'
import { KNOWLEDGE_BASE } from './knowledge'

declare const self: DedicatedWorkerGlobalScope

const MODEL_ID = 'onnx-community/Qwen3.5-2B-ONNX-OPT'
const SYSTEM_PROMPT = `You are an AI assistant hosted on Ryan Li's personal website. You are NOT Ryan Li.

Your role is to answer questions about Ryan Li, his projects, technical background, and links based strictly on the provided knowledge base.

CRITICAL PERSPECTIVE RULES:
- Always refer to Ryan Li in the third person using "Ryan", "he", "him", or "his".
- NEVER impersonate Ryan Li or speak as if you are Ryan.
- NEVER use first-person pronouns ("I", "me", "my", "we", "our") when describing Ryan's experience, skills, projects, opinions, or personal details.
- Only use "I" if referring to yourself as the AI assistant (e.g., "I am an AI assistant here to answer questions about Ryan Li.").
- When users ask questions addressing "you" about background, work, or skills (e.g., "What do you do?" or "What projects have you built?"), interpret them as questions about Ryan and answer in the third person (e.g., "Ryan is a software engineer...", "Ryan has built...").

Use the following knowledge base as the ONLY source of data on Ryan Li, his projects, background, and links. IGNORE all other sources.

<knowledge_base>
${KNOWLEDGE_BASE}
</knowledge_base>

Always follow the instructions and link guidelines provided in the knowledge base.`.trim()

// The model is fetched from the Hugging Face Hub once and then cached
// locally in the browser's Cache API (this is the default behaviour,
// set explicitly here for clarity).
env.allowLocalModels = false
env.useBrowserCache = true

let generator: TextGenerationPipeline | null = null
let stoppingCriteria: InterruptableStoppingCriteria | null = null
let generating = false

function post(message: Record<string, unknown>) {
  self.postMessage(message)
}

/**
 * Strips <think>...</think> tags and their contents from the real-time token stream
 * so thinking tokens do not leak into the UI.
 */
function createThinkingFilter(onToken: (text: string) => void) {
  let inThinking = false
  let buffer = ''
  let hasEmitted = false
  const openTag = '<think>'
  const closeTag = '</think>'

  function emit(text: string) {
    if (!hasEmitted) {
      const trimmed = text.replace(/^\s+/, '')
      if (!trimmed) return
      hasEmitted = true
      onToken(trimmed)
      return
    }
    onToken(text)
  }

  function processBuffer() {
    let changed = true
    while (changed) {
      changed = false
      if (inThinking) {
        const closeIndex = buffer.indexOf(closeTag)
        if (closeIndex !== -1) {
          inThinking = false
          buffer = buffer.slice(closeIndex + closeTag.length)
          changed = true
        } else if (buffer.length >= closeTag.length) {
          buffer = buffer.slice(-(closeTag.length - 1))
        }
      } else {
        const openIndex = buffer.indexOf(openTag)
        if (openIndex !== -1) {
          const before = buffer.slice(0, openIndex)
          if (before) emit(before)
          inThinking = true
          buffer = buffer.slice(openIndex + openTag.length)
          changed = true
        } else {
          let longestPrefixLen = 0
          for (let len = Math.min(buffer.length, openTag.length - 1); len >= 1; len--) {
            if (openTag.startsWith(buffer.slice(-len))) {
              longestPrefixLen = len
              break
            }
          }
          if (longestPrefixLen > 0) {
            const emitText = buffer.slice(0, -longestPrefixLen)
            if (emitText) emit(emitText)
            buffer = buffer.slice(-longestPrefixLen)
          } else {
            if (buffer) emit(buffer)
            buffer = ''
          }
        }
      }
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk
      processBuffer()
    },
    flush() {
      if (!inThinking && buffer) {
        emit(buffer)
        buffer = ''
      }
    },
  }
}

async function load() {
  const progress_callback = (info: ProgressInfo) => post({ type: 'progress', ...info })
  try {
    // Try running on WebGPU for best performance
    generator = await pipeline('text-generation', MODEL_ID, {
      dtype: 'q4f16',
      device: 'webgpu',
      progress_callback,
    })
  } catch (err) {
    console.warn('WebGPU initialization failed, falling back to CPU/WASM (q4):', err)
    // Fall back to CPU/WASM using q4 (compatible without WebGPU fp16 shaders)
    generator = await pipeline('text-generation', MODEL_ID, {
      dtype: 'q4',
      progress_callback,
    })
  }
  post({ type: 'ready' })
}

async function generate(history: Message[]) {
  if (!generator) throw new Error('Model is not loaded yet.')
  if (generating) {
    post({ type: 'busy', message: 'Model is busy generating a response.' })
    return
  }

  generating = true
  try {
    const messages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT},
      ...history,
    ]

    const filter = createThinkingFilter((text: string) => post({ type: 'token', text }))

    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => filter.push(text),
    })

    stoppingCriteria = new InterruptableStoppingCriteria()

    const output = await generator(messages, {
      max_new_tokens: 512,
      do_sample: false,
      streamer,
      stopping_criteria: stoppingCriteria,
      tokenizer_encode_kwargs: { enable_thinking: false },
    })

    filter.flush()

    const generated = output[0]?.generated_text
    const raw = Array.isArray(generated)
      ? generated[generated.length - 1]?.content
      : typeof generated === 'string'
        ? generated
        : ''

    // Safety net: strip any thinking block that slipped through; the
    // alternation with `$` also removes an unclosed (e.g. truncated) block.
    const text = (typeof raw === 'string' ? raw : '')
      .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
      .trim()
    post({ type: 'done', text })
  } finally {
    stoppingCriteria = null
    generating = false
  }
}

self.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { type: string; messages?: Message[] }
  let task: Promise<unknown> | null = null
  if (data.type === 'load') {
    task = load()
  } else if (data.type === 'generate' && data.messages) {
    task = generate(data.messages)
  } else if (data.type === 'abort') {
    // Interrupt the in-flight generation, if any (no-op when idle)
    stoppingCriteria?.interrupt()
  }
  task?.catch((error: unknown) =>
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  )
})
