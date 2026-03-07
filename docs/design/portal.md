# Portal 詳細設計

## 対応要求

- [FR-005](../requirements/README.md) WebUI (Portal)
- [NFR-007](../requirements/README.md) Portal 認証

## 責務

ブラウザ向けの HTTP サーバ。2つの機能を提供する:

1. **リポジトリ一覧 API**: Agent Pool が管理中のリポジトリ一覧を返す
2. **リバースプロキシ**: 各リポジトリの opencode web へリクエストを転送する

## エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/` | リポジトリ一覧 UI (HTML) |
| GET | `/api/repos` | リポジトリ一覧 (JSON) |
| ALL | `/repos/:name/**` | opencode web へのリバースプロキシ |

## リバースプロキシ

```
GET /repos/my-blog/
  → http://localhost:{AgentPool.getPort("my-blog")}/
```

- Agent Pool からリポジトリ名でポートを解決
- プロセスが停止中ならオンデマンドで起動
- WebSocket もプロキシ対象 (opencode web の SSE/WS)

## 依存関係

```
Browser --> Portal --> AgentPool.getOrStart(repoName)
                   --> http-proxy-middleware --> opencode :port
```

## 認証 (NFR-007)

`PORTAL_PASSWORD` が設定されている場合、全エンドポイントに HTTP Basic Auth を適用する。

- ミドルウェア: Hono の `basicAuth` ヘルパー
- ユーザ名: `admin` (固定)
- パスワード: 環境変数 `PORTAL_PASSWORD`
- `PORTAL_PASSWORD` 未設定時は認証なし (ローカル開発用)

## 技術選定

- HTTP Server: Hono
- Proxy: http-proxy-middleware

## 見積もり

~50行
