import { describe, expect, test } from "vitest"
import { parseRepoFromTopic } from "../../src/platforms/parse-topic.js"

describe("parseRepoFromTopic", () => {
  test("extracts repo from topic", () => {
    expect(parseRepoFromTopic("repo:hummer98/my-blog")).toBe("hummer98/my-blog")
  })

  test("extracts repo with extra metadata", () => {
    expect(parseRepoFromTopic("repo:hummer98/my-blog | branch:main | Next.js")).toBe(
      "hummer98/my-blog",
    )
  })

  test("extracts repo with surrounding text", () => {
    expect(parseRepoFromTopic("This channel is for repo:org/project discussion")).toBe(
      "org/project",
    )
  })

  test("returns undefined for topic without repo", () => {
    expect(parseRepoFromTopic("general discussion")).toBeUndefined()
  })

  test("returns undefined for empty topic", () => {
    expect(parseRepoFromTopic("")).toBeUndefined()
  })

  test("returns undefined for undefined", () => {
    expect(parseRepoFromTopic(undefined)).toBeUndefined()
  })

  test("returns undefined for null", () => {
    expect(parseRepoFromTopic(null)).toBeUndefined()
  })

  test("extracts first repo when multiple present", () => {
    expect(parseRepoFromTopic("repo:first/one repo:second/two")).toBe("first/one")
  })
})
