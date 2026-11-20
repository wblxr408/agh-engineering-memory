# Shared Engineering Memory for AGH

让 Agnes Harness 与 Antigravity 读取同一份本地工程知识库，并核实原文、纠正记录和保存结果。

**这是现有 Engineering Memory 共享服务的连接插件。** 它依赖已经运行、实现下述回环 RPC 协议的本地服务。它不包含该服务，也不是普通 `basic-memory mcp` 的直接客户端；仅安装本插件不会创建知识库或启动索引服务。现有服务的存储、检索质量、项目权限和笔记治理由服务所有者管理。其他用户接入前应对照 [协议](docs/protocol.md) 确认兼容性。

## 功能

| AGH 工具 | 作用 |
| --- | --- |
| `engineering_memory_search` | 默认文本检索，可查历史、限定范围和翻页 |
| `engineering_memory_read` | 读取原文、指定章节或行范围，保留来源内容 |
| `engineering_memory_save` | 可选的新笔记保存；禁止覆盖已有笔记 |
| `engineering_memory_write_status` | 查询持久化状态，区分 queued 与 saved |

插件同时注册 `shared-engineering-memory` 使用技能。遇到历史、纠正或关键原文问题时，先搜索再读原文，明确版本、时间和冲突证据；不能只凭检索摘要作结论。

另附标准 stdio MCP 入口，便于 Antigravity 连接同一服务。两端不复制知识库，也不创建第二个后台监听器。

## AGH 安装与配置

需要 Node.js 24.10+、扩展 API 5.x 的 AGH，以及兼容的现有本地共享服务。插件入口是根目录 `index.mjs`，发布树包含全部运行源码。原生入口使用 AGH 提供的 TypeBox 0.34.33；不需下载运行依赖，也没有安装脚本。stdio 入口仅使用 Node 内置模块。

市场收录后，在 **Plugins → Market → Community** 搜索 `@wblxr408/engineering-memory`，检查来源和能力声明后按 AGH 的安装、信任及启用流程操作。收录前也可使用 AGH 支持的本地目录安装方式指向此仓库检出目录。市场索引会固定具体 Git 提交。

在插件实例配置中设置：

```json
{
  "memoryHome": "C:/Users/YOUR_NAME/.codex/services/engineering-memory",
  "project": "main",
  "allowWrites": false,
  "timeoutMs": 145000
}
```

`memoryHome` 是包含 `resource-endpoint.json` 的**服务目录**，不是 Markdown 笔记库目录。默认值为当前用户主目录下 `.codex/services/engineering-memory`。项目默认 `main`，支持简单项目名。实例配置由使用者管理，工具参数不能改变连接目录或项目。

默认只读。需要保存新笔记时，将 `allowWrites` 设为 `true`；AGH 保存工具按宿主写操作策略执行，声明为不可重放且需要审批。已有笔记的修改仍应通过知识库原有治理入口处理。`timeoutMs` 为 1–145000 毫秒，实际调用也遵循宿主工具期限。

请实际请求一次与自己知识库有关的检索，再读取命中的原文。若启用了保存，创建一个有用的新笔记、按返回的 write_id 查询保存状态，再回读原文。服务失联时插件会明确报错；这不能证明知识库为空。

## Antigravity 使用同一知识库

保留现有 `mcpServers` 配置，新增以下条目；路径替换成自己实际的 Node 和本仓库检出位置：

```json
{
  "mcpServers": {
    "shared-engineering-memory": {
      "command": "C:/Path/To/node.exe",
      "args": [
        "C:/Path/To/agh-engineering-memory/bin/mcp.mjs",
        "--memory-home", "C:/Path/To/engineering-memory",
        "--project", "main"
      ]
    }
  }
}
```

需要允许创建笔记时，在 `args` 末尾添加 `--allow-writes`。MCP 入口默认只提供 `bm_search`、`bm_read` 和 `memory_write_status`；启用写入后再提供 `bm_write`。MCP 宿主自行控制工具授权；stdio 入口不会模拟 AGH 的审批机制。它不自动修改全局配置。

将 [共享知识库使用说明](skills/shared-engineering-memory/SKILL.md) 中的原文检索和保存规则加入自己的 Antigravity 项目规则或全局规则；MCP 工具名见该文件映射。重新加载该 MCP 连接后用自己的问题验证检索和原文读取。

## 权限与数据

- 仅读取所配置服务目录中的 `resource-endpoint.json`，从中读取动态回环端口和认证值。
- 只连接 `127.0.0.1`，不接受远程主机地址，不启动进程或新服务。
- 回环服务接收检索词、笔记标识、可选保存内容；该服务是否另用模型或网络由其自身配置决定。
- 认证值只用于本机 RPC，不写入输出或插件包。发行版不包含私人笔记、真实端点文件或个人机器配置。
- 请求上限 1 MiB、响应上限 8 MiB。传输中断、取消或超时后不自动重发；写入结果可能未知，应查询状态或目标笔记。
- `project` 是操作目标选择，不是插件提供的多租户安全隔离。端点认证、目录权限和服务端项目授权仍由现有服务负责。

能力声明包含文件读取、回环网络和工具注册，因此按市场规则需要人工审查。详见 [协议](docs/protocol.md) 与 [验证记录](docs/verification.md)。

## 开发

```sh
node --test
npm pack --pack-destination ../plugin-packages
```

测试使用临时协议服务验证原文内容、保存状态、拒绝输入、取消和断线行为，不连接个人知识库。没有编译步骤：Git 发行树本身就是可安装运行产物。打包文件不提交到发行树。

本插件没有 LongMemEval-S 或 MemoryAgentBench 评测成绩；原文传输验收不等于最终答案准确率基准。

MIT License.
