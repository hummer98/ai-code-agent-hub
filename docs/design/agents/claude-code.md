# Claude Code Agent 詳細設計

## 対応要求

- [FR-006](../requirements/README.md) マルチエージェント

## 責務

Claude Code プロセスを起動・管理する Agent 実装。
OpenCode Agent と同じ Agent インターフェースを実装し、差し替え可能にする。

## 優先度

低。まず OpenCode Agent で MVP を構築し、必要に応じて追加する。

## 設計方針

Claude Code の SDK / CLI のインターフェースが確定した段階で詳細化する。
Agent インターフェースに準拠するため、Router や Agent Pool への影響はない。

## 見積もり

~60行
