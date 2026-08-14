# dsh-openclaw-acp

[English](README.md)

这是一个原生 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 组合包，通过官方 Agent Client Protocol（ACP）传输，让 [OpenClaw](https://github.com/openclaw/openclaw) 调用 Harness profile。

本集成刻意把责任拆成三层：

1. DeepSeek Harness 负责 Agent、模型、工具、工作区沙箱和会话日志。
2. OpenClaw ACPX 负责 ACP 进程生命周期、调度与对话路由。
3. OpenClaw 渠道插件负责微信或其他消息通道。

本包不嵌入微信 SDK，也不复制 Harness。它以 `dsh.bundle` 安装，并加载 DeepSeek 官方 `@deepseek-ai/dsh-acp` 插件。

## 前置条件

- pnpm 10，以及 OpenClaw 支持的 Node.js 版本；稳定版 OpenClaw `2026.7.1-2` 要求 Node.js 22.22.3+、24.15.0+ 或 25.9.0+
- DeepSeek Harness `0.1.0-rc.6`
- OpenClaw `2026.7.1-2` 或更高版本，并已安装官方 `@openclaw/acpx` 插件
- OpenClaw Gateway 进程可以读取 `DEEPSEEK_API_KEY`
- 已配置一个 OpenClaw 渠道，例如腾讯 `@tencent-weixin/openclaw-weixin`

## 1. 安装 Harness 组合包

```bash
npm install -g @deepseek-ai/dsh@0.1.0-rc.6
dsh plugin --profile openclaw add https://github.com/BeAChanger/dsh-openclaw-acp/releases/download/v0.1.3/dsh-openclaw-acp-0.1.3.tgz
dsh --profile openclaw --dump-config
```

该命令使用预构建的 release 产物，安装时不会执行仓库构建脚本。Release 页面同时发布 SHA-256 校验文件。

默认路由是 `deepseek-official/deepseek-v4-flash`，启用 thinking，推理强度为 `max`，上下文窗口为 1,000,000 token，输出上限为 384,000 token。如需覆盖模型，在 Gateway 环境中设置：

```bash
export DSH_OPENCLAW_PROVIDER=deepseek-official
export DSH_OPENCLAW_MODEL=deepseek-v4-pro
```

## 2. 在 OpenClaw 注册 Harness

安装并启用 OpenClaw 官方 ACP runtime：

```bash
openclaw plugins install @openclaw/acpx@2026.7.1
openclaw config set plugins.entries.acpx.enabled true
```

如需接入微信，安装本组合已验证的腾讯渠道版本。最后一条命令会显示二维码，必须由运营方扫码授权：

```bash
openclaw plugins install @tencent-weixin/openclaw-weixin@2.4.6
openclaw config set plugins.entries.openclaw-weixin.enabled true
openclaw channels login --channel openclaw-weixin
```

把以下内容加入 OpenClaw 配置：

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
      },
      "openclaw-weixin": {
        enabled: true
      }
    }
  }
}
```

重启 Gateway。先验证协议边界，再测试具体渠道：

```text
/acp doctor
/acp spawn deepseek-harness --cwd /工作区绝对路径
```

如果渠道支持当前对话绑定，可以加 `--bind here`。如果渠道没有声明 ACP 对话绑定能力，就使用不绑定的一次性任务，让 OpenClaw 把完成结果回传给父对话。

## 3. 从微信调用

微信渠道接入同一个 Gateway 后，消息链路是：

```text
微信 -> OpenClaw 渠道 -> ACPX -> dsh --profile openclaw -> DeepSeek Harness
```

多个微信号同时登录时，建议按账号、渠道和发送者隔离私聊会话：

```bash
openclaw config set session.dmScope per-account-channel-peer
```

微信 token 和用户标识不会跨过 ACP 边界。OpenClaw 负责解析渠道发送者与会话；Harness 只接收指定工作区和提示词内容。

## 安全默认值

- OpenClaw 沙箱不会包裹外部 ACP 进程；Harness 通过自己的 `DSH_PERMISSION_MODE` 执行边界。
- 生产环境保留 Harness 默认 `workspace-write`，除非部署明确需要更高权限。
- 暂时不要为此 Agent 启用 OpenClaw ACPX 的 MCP 工具桥。Harness ACP `0.1.0-rc.6` 会拒绝非空 `mcpServers`。
- 用独立操作系统账号运行 Gateway 与 Harness，并限制允许访问的工作区根目录。
- `danger-full-access` 只能作为紧急权限，不能作为生产默认值。

## 已知限制

- Harness ACP 当前只支持新会话，不声明加载、恢复、fork 或会话列表能力。
- 只返回已提交的 assistant 文本，不转发实时推理或工具事件。
- 渠道能否持久绑定取决于 OpenClaw 渠道适配器；不支持时使用一次性父对话回传。
- 当前 Harness ACP 拒绝非空 `mcpServers`，所以不会把 OpenClaw 插件工具注入 Harness。

## 验证

```bash
npm install
npm test
npm run test:acp
npm run pack:check
```

`test:acp` 会把本组合包安装进隔离 profile，并执行两段协议验证：先直接启动真实 `dsh`，验证 ACP 协商与纯 JSON-RPC stdout；再通过 OpenClaw 官方 ACPX 插件所使用的已发布 `acpx@0.11.2` runtime，以自定义 Agent 方式拉起该 profile。两段验证都会完成 `initialize` 和 `session/new`，不调用模型，也不需要真实 API key。

## 许可证

MIT
