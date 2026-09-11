/// <reference lib="webworker" />

import { env, pipeline, TextStreamer } from '@huggingface/transformers'
import type { Message, ProgressInfo, TextGenerationPipeline } from '@huggingface/transformers'
import { KNOWLEDGE_BASE } from './knowledge'

declare const self: DedicatedWorkerGlobalScope

const MODEL_ID = 'HuggingFaceTB/SmolLM3-3B-ONNX'
const SYSTEM_PROMPT = `You are an AI assistant on Ryan Li's personal website, where your purpose is to provide information about Ryan Li, the website's owner.

Ryan Li has explicitly authorized you share his personal information ONLY IF you use the following knowledge base as the ONLY source of data on him, his projects, background, and links. IGNORE all other sources.

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
let generating = false

function post(message: Record<string, unknown>) {
  self.postMessage(message)
}

async function load() {
  const progress_callback = (info: ProgressInfo) => post({ type: 'progress', ...info })
  try {
    // The q4f16 quantization runs best on WebGPU
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
  if (generating) return
  generating = true
  try {
    // const thinking = true;

    const messages: Message[] = [{ role: 'system', content: SYSTEM_PROMPT}, ...history]

    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => post({ type: 'token', text }),
    })



    const output = await generator(messages, {
      max_new_tokens: 1024,
      do_sample: true,
      temperature: 0.43,
      top_p: 0.9,
      streamer,
      // SmolLM3 reasons in <think> blocks by default; disable it so the
      // assistant answers directly.
      tokenizer_encode_kwargs: { enable_thinking: false },
    })

    const content = output[0]?.generated_text?.at(-1)?.content
    const text = (typeof content === 'string' ? content : '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim()
    post({ type: 'done', text })
  } finally {
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
  }
  task?.catch((error: unknown) =>
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  )
})
