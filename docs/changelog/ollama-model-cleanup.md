# 2026-03-22 - Ollama Model Cleanup

Task / goal:
- 删除未使用的 `qwen3:14b`，仅保留当前项目默认使用的 `qwen2.5:14b`，回收本机磁盘空间。

Key changes:
- 从本机 Ollama 模型库中移除了 `qwen3:14b`。
- 保留 `qwen2.5:14b` 作为当前项目的默认本地模型，不影响现有 `.env.local` 与应用配置。

Files touched:
- `docs/changelog/ollama-model-cleanup.md`

Verification commands and results:
- `PATH=/opt/homebrew/bin:/usr/local/bin:$PATH /opt/homebrew/bin/ollama rm qwen3:14b` -> ✅ 输出 `deleted 'qwen3:14b'`。
- `PATH=/opt/homebrew/bin:/usr/local/bin:$PATH /opt/homebrew/bin/ollama list` -> ✅ 仅剩 `qwen2.5:14b`。
- `df -h /` -> ✅ 根分区可用空间从约 `53Gi` 增加到约 `62Gi`。

Remaining risks / follow-up:
- 无代码或配置风险；如果后续想尝试 reasoning 型本地模型，需要重新拉取 `qwen3:14b` 或其他替代模型。
