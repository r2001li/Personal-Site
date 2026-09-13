/// <reference lib="webworker" />

import { env, TextStreamer, AutoProcessor, Gemma4ForConditionalGeneration } from '@huggingface/transformers'
import type { Message, ProgressInfo, Tensor } from '@huggingface/transformers'
import { KNOWLEDGE_BASE } from './knowledge'

declare const self: DedicatedWorkerGlobalScope

const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX'
const SYSTEM_PROMPT = `You are an AI assistant on Ryan Li's personal website.

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

type ProcessorType = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>

let processor: ProcessorType | null = null
let generator: Gemma4ForConditionalGeneration | null = null
let generating = false

function post(message: Record<string, unknown>) {
  self.postMessage(message)
}

async function load() {
  const progress_callback = (info: ProgressInfo) => post({ type: 'progress', ...info })
  processor = await AutoProcessor.from_pretrained(MODEL_ID)
  try {
    // Try running on WebGPU for best performance
    generator = (await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: 'q4f16',
      device: 'webgpu',
      progress_callback,
    })) as unknown as Gemma4ForConditionalGeneration
  } catch {
    // Fall back to the default device when WebGPU is not available
    generator = (await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: 'q4f16',
      progress_callback,
    })) as unknown as Gemma4ForConditionalGeneration
  }
  post({ type: 'ready' })
}

async function generate(history: Message[]) {
  if (!generator || !processor) throw new Error('Model is not loaded yet.')
  if (generating) {
    post({ type: 'error', message: 'Model is busy generating a response.' })
    return
  }
  generating = true
  try {
    const messages: Message[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...history]

    const prompt = processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    } as Record<string, unknown>)

    const inputs = (await processor(prompt, null, null, {
      add_special_tokens: false,
    })) as { input_ids: Tensor; attention_mask: Tensor }

    const streamer = new TextStreamer(processor.tokenizer!, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => post({ type: 'token', text }),
    })

    const output = (await generator.generate({
      ...inputs,
      max_new_tokens: 512,
      do_sample: false,
      streamer,
    })) as Tensor

    const promptTokens = inputs.input_ids.dims[inputs.input_ids.dims.length - 1]
    const totalTokens = output.dims[output.dims.length - 1]
    const generatedTokens = output.slice(null, [promptTokens, totalTokens])
    const decoded = processor.batch_decode(generatedTokens, {
      skip_special_tokens: true,
    })
    const text = (decoded[0] ?? '')
      .replace(/<\|channel>[\s\S]*?<channel\|>/g, '')
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
