# Session Pool 詳細設計

## 対応要求

- [FR-002](../requirements/README.md) マルチセッション
- [FR-008](../requirements/README.md) セッションライフサイクル

## 責務

スレッド ID (Discord/Slack) → セッション ID (Agent) のマッピングを管理する。

## 状態管理

```typescript
Map<threadId, {
  sessionId: string
  repoName: string
  lastAccess: Date
}>
```

## ライフサイクル

```
作成:  @bot リプライ → スレッド作成 → session.create() → Map 登録
利用:  スレッド内メッセージ → Map から sessionId 取得 → session.prompt()
休止:  アイドル N 分 → Agent プロセス停止 (sessionId は Map に保持)
復帰:  スレッド内に再メッセージ → Agent プロセス再起動 → 既存 sessionId で prompt() (※)
終了:  スレッド archive → Map から削除
```

※ opencode SDK (v1.2.21) に resume API はない。セッションはサーバー側で永続化されるため、
既存の sessionId で `prompt()` を呼べば会話は自動的に継続される。

## Router との連携

Router が以下のメソッドを呼ぶ:

- `getOrCreate(threadId, repoName, agentProcess)` → sessionId
  - Map にあれば既存の sessionId を返す (resume 不要、prompt() で会話継続)
  - なければ `agentProcess.createSession()` で新規作成
- `get(threadId)` → sessionId | undefined
- `remove(threadId)` → セッション破棄

## タイマー回収についての設計判断

seed ドキュメントでは Session Pool の責務に「タイマー回収」を含めていたが、
設計検討の結果 **Agent Pool に集約** した。

理由: プロセスのライフサイクル (起動/停止/アイドル回収) とタイマーを同一コンポーネント (AgentPool) で
管理する方が一貫性がある。Session Pool がタイマーを持つと、プロセス停止とセッション破棄のタイミングが
分離して状態の不整合が生じるリスクがある。

現行設計:
- Session Pool 自身はタイマーを持たない
- Agent Pool のアイドルタイムアウトでプロセスが停止されたとき、対応するセッションマッピングは保持される
- プロセス再起動後、既存 sessionId で `prompt()` を呼べば会話は継続される (opencode がセッションを永続化しているため)

## 見積もり

~80行
