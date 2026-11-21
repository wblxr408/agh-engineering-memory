# 共享工程知识库 · Shared Engineering Memory

这是 Agnes Harness 的只读研究 Bundle。安装后可从「智能体」打开共享工程知识库，检索笔记并回查原文。连接由所有者在 AGH 中单独配置和授权，连接 ID 为 `shared-engineering-memory`。

## 接入已有知识库

1. 启动已有的兼容 Engineering Memory 服务。AGH 和 Antigravity 可各自配置 MCP 连接并使用同一服务。服务兼容性见 [协议说明](https://github.com/wblxr408/agh-engineering-memory/blob/v0.1.0/docs/protocol.md)。
2. 准备独立的 stdio MCP 连接器。已有兼容连接器可继续使用，也可检出此前发布的连接器源码。使用其 `bin/mcp.mjs` 文件作为 MCP 的启动参数。

   ```sh
   git clone --branch v0.1.0 --single-branch https://github.com/wblxr408/agh-engineering-memory.git engineering-memory-mcp
   ```

3. 在 AGH 的「连接（MCP）」新增 `shared-engineering-memory`，类型选 stdio，命令填 `node`（Node.js 24.10+），参数依次填入下列值。使用绝对路径，并把最后的 `main` 改为实际项目名。

   ```text
   /absolute/path/to/engineering-memory-mcp/bin/mcp.mjs
   --memory-home
   /absolute/path/to/engineering-memory-service
   --project
   main
   ```

   服务目录包含 `resource-endpoint.json`。将允许的工具设为 `bm_search`、`bm_read` 和 `memory_write_status`，保留默认只读设置。此连接器需要回环网络和端点文件读取权限。在支持受限进程的系统上，选择 `network` 沙箱，并配置可读的工作区以涵盖这两个所需路径。当前 AGH 的 Windows stdio 只支持所有者明确批准的 `off-with-warning`，该设置会授予进程完整主机访问权限。在 AGH 中审核配置、测试连接并启用。 [AGH MCP 管理指南](https://github.com/AgnesAI-Labs/agnes-harness/blob/main/docs/guide/mcp.md)

4. 从 AGH 市场安装并启用 `@wblxr408/engineering-memory`，从「智能体」启动「共享工程知识库」。提交检索问题并打开命中的原始笔记。建议保留来源标识、版本及纠正记录。

市场 Bundle v0.2.0 提供启动入口、MCP 连接 ID 和只读会话策略。读取端点文件、连接本机服务以及认证由单独配置的进程负责。 [旧版独立连接器及参数](https://github.com/wblxr408/agh-engineering-memory/tree/v0.1.0)

MIT License.
