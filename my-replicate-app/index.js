import Replicate from 'replicate'
import dotenv from 'dotenv'
dotenv.config()

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
  userAgent: 'https://www.npmjs.com/package/create-replicate'
})
const model = 'playgroundai/playground-v2.5-1024px-aesthetic:a45f82a1382bed5c7aeb861dac7c7d191b0fdf74d8d57c4a0e6ed7d4d0bf7d24'
const input = {
  width: 1024,
  height: 1024,
  prompt: 'Astronaut in a jungle, cold color palette, muted colors, detailed, 8k',
  scheduler: 'DPMSolver++',
  num_outputs: 1,
  guidance_scale: 3,
  apply_watermark: true,
  negative_prompt: 'ugly, deformed, noisy, blurry, distorted',
  prompt_strength: 0.8,
  num_inference_steps: 25,
}

console.log('Using model: %s', model)
console.log('With input: %O', input)

console.log('Running...')
const output = await replicate.run(model, { input })
console.log('Done!', output)
