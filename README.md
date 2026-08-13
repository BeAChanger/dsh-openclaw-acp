# dsh-openclaw-acp

[简体中文](README.zh-CN.md)

A native [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle that exposes a Harness profile to [OpenClaw](https://github.com/openclaw/openclaw) through the official Agent Client Protocol (ACP) transport.

The integration deliberately has three owners:

1. DeepSeek Harness owns the agent, model, tools, workspace sandbox, and session log.
2. OpenClaw ACPX owns ACP process lifecycle, dispatch, and conversation routing.
3. The OpenClaw channel plugin owns WeChat or any other messaging transport.

This package does not embed a WeChat SDK and does not duplicate Harness. It installs as a `dsh.bundle` and mounts the official `@deepseek-ai/dsh-acp` plugin.

## Prerequisites

- Node.js 22 or newer
- DeepSeek Harness `0.1.0-rc.6`
- OpenClaw with the official `@openclaw/acpx` plugin
- `DEEPSEEK_API_KEY` available to the OpenClaw Gateway process
- A configured OpenClaw channel, such as Tencent's `@tencent-weixin/openclaw-weixin`

## 1. Install the Harness bundle

```bash
npm install -g @deepseek-ai/dsh@0.1.0-rc.6
dsh plugin --profile openclaw add github:BeAChanger/dsh-openclaw-acp#v0.1.2
dsh --profile openclaw --dump-config
```

The default route is `deepseek-official/deepseek-v4-flash`, with thinking enabled, `max` reasoning effort, a 1,000,000-token context window, and a 384,000-token output cap. Override the model in the Gateway environment when needed:

```bash
export DSH_OPENCLAW_PROVIDER=deepseek-official
export DSH_OPENCLAW_MODEL=deepseek-v4-pro
```

## 2. Register Harness in OpenClaw

Install and enable OpenClaw's official ACP runtime:

```bash
openclaw plugins install @openclaw/acpx
openclaw config set plugins.entries.acpx.enabled true
```

Add this configuration to the OpenClaw config:

```json5
{
  acp: {
    enabled: true,
    backend: "acpx",
    defaultAgent: "deepseek-harness",
    allowedAgents: ["deepseek-harness"]
  },
  plugins: {
    entries: {
      acpx: {
        enabled: true,
        config: {
          agents: {
            "deepseek-harness": {
              command: "dsh",
              args: ["--profile", "openclaw"]
            }
          }
        }
      }
    }
  }
}
```

Restart the Gateway, then verify the boundary before testing a channel:

```text
/acp doctor
/acp spawn deepseek-harness --cwd /absolute/path/to/workspace
```

On channels that support conversation binding, add `--bind here`. If a channel does not advertise ACP binding, use the unbound one-shot flow and let OpenClaw relay completion to the parent conversation.

## 3. Call it from WeChat

Once a WeChat channel is connected to the same Gateway, the message path is:

```text
WeChat -> OpenClaw channel -> ACPX -> dsh --profile openclaw -> DeepSeek Harness
```

No WeChat token or user identifier crosses the ACP boundary. OpenClaw resolves the channel sender and session; Harness receives only the selected workspace and prompt content.

## Security defaults

- OpenClaw's sandbox does not wrap external ACP processes. Harness enforces its own boundary through `DSH_PERMISSION_MODE`.
- Keep the Harness default `workspace-write` mode unless the deployment explicitly requires more access.
- Do not enable OpenClaw's ACPX MCP tool bridges for this target yet. Harness ACP `0.1.0-rc.6` rejects non-empty `mcpServers`.
- Run the Gateway and Harness under a dedicated OS account and restrict the allowed workspace roots.
- Treat `danger-full-access` as a break-glass mode, not a production default.

## Known limitations

- Harness ACP currently supports new sessions only; it does not advertise load, resume, fork, or session listing.
- It returns committed assistant text, not live reasoning or tool events.
- Channel-level persistent binding depends on the OpenClaw channel adapter. Use one-shot parent relay where binding is unavailable.
- OpenClaw plugin tools are not injected into Harness because the current Harness ACP transport rejects non-empty `mcpServers`.

## Verification

```bash
npm install
npm test
npm run test:acp
npm run pack:check
```

`test:acp` installs the bundle into an isolated profile, starts the real `dsh` process, negotiates ACP, creates a session, and verifies that stdout contains JSON-RPC frames only. It does not call a model and does not require a real API key.

## License

MIT
