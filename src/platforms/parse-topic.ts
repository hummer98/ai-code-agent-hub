/**
 * チャンネルトピック文字列から repo:owner/name を抽出し owner/name を返す。
 * Discord/Slack の両 Platform から共有利用。
 */
export function parseRepoFromTopic(topic: string | undefined | null): string | undefined {
  if (!topic) return undefined
  const match = topic.match(/repo:([^\s|]+)/)
  return match ? match[1] : undefined
}
