import * as acp from '@deepseek-ai/dsh-acp'
import Schema from '@deepseek-ai/schemastery'

export const name = 'openclaw-acp'
export const inject = ['agents']

export const Config = Schema.object({
  provider: Schema.string().default('deepseek-official'),
  model: Schema.string().default('deepseek-v4-flash'),
})

/**
 * Mount DeepSeek Harness's official automation-only ACP transport.
 * OpenClaw owns channel delivery and conversation routing; this plugin owns
 * only the Harness-to-ACP boundary.
 */
export async function apply(ctx, config) {
  await ctx.effect(async function* () {
    const transport = ctx.plugin(acp, {
      provider: config.provider,
      model: config.model,
    })
    await transport
    yield transport.dispose
  }, 'openclaw-acp.transport')
}
