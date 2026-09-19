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

async function load() {
  const progress_callback = (info: ProgressInfo) => post({ type: 'progress', ...info })
  try {
    // Try running on WebGPU for best performance
    generator = await pipeline('text-generation', MODEL_ID, {
      dtype: 'q4f16',
      device: 'webgpu',
      progress_callback,
    })
  } catch {
    // Fall back to the default device when WebGPU is not available
    generator = await pipeline('text-generation', MODEL_ID, {
      dtype: 'q4f16',
      progress_callback,
    })
  }
  post({ type: 'ready' })
}

async function generate(history: Message[]) {
  if (!generator) throw new Error('Model is not loaded yet.')
  if (generating) {
    post({ type: 'error', message: 'Model is busy generating a response.' })
    return
  }

  generating = true
  try {
    const messages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT},
      ...history,
    ]

    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => post({ type: 'token', text }),
    })

    stoppingCriteria = new InterruptableStoppingCriteria()

    const output = await generator(messages, {
      max_new_tokens: 512,
      do_sample: false,
      streamer,
      stopping_criteria: stoppingCriteria,
      tokenizer_encode_kwargs: { enable_thinking: false },
    })

    const content = output[0]?.generated_text?.at(-1)?.content

    // Safety net: strip any thinking block that slipped through; the
    // alternation with `$` also removes an unclosed (e.g. truncated) block.
    const text = (typeof content === 'string' ? content : '')
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
