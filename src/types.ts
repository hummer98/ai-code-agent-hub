/**
 * Platform → Router に渡される正規化されたメッセージ
 */
export interface IncomingMessage {
  platformName: string
  channelId: string
  threadId?: string
  userId: string
  content: string
  repoHint?: string
  raw: unknown
}

/**
 * AI エンジン層のプロセスラッパー。
 * 1 リポジトリに対して起動された Agent プロセスのセッション操作を提供する。
 */
export interface AgentProcess {
  createSession(opts?: { cwd?: string }): Promise<string>
  resumeSession(sessionId: string): Promise<void>
  prompt(sessionId: string, content: string): AsyncIterable<string>
  destroySession(sessionId: string): void
  alive(): boolean
}

/**
 * AI エンジン層の抽象。Agent プロセスの起動・停止を担う。
 */
export interface Agent {
  name: string
  startProcess(repoPath: string): Promise<AgentProcess>
  stopProcess(repoPath: string): void
}

/**
 * Platform.reply() に渡すリッチ応答。
 * テキスト + オプションでセレクトメニューやボタンを含む。
 */
export interface ReplyPayload {
  text: string
  select?: {
    id: string
    placeholder: string
    options: Array<{ label: string; value: string; description?: string; selected?: boolean }>
  }
}

/**
 * UI 層の抽象。外部チャットプラットフォームとの接続を担う。
 */
export interface Platform {
  name: string
  start(): Promise<void>
  stop(): void
  onMessage(handler: (msg: IncomingMessage) => void): void
  reply(msg: IncomingMessage, content: string | ReplyPayload): Promise<void>
  startThread(msg: IncomingMessage, name: string): Promise<string>
}
