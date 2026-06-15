import { describe, expect, it } from "vitest"

import { ActionApiError, Client, type Actions, type FetchLike } from "../src"

describe("Client", () => {
  it("executes typed actions with bearer token auth", async () => {
    const requests: Array<{ input: string; init: Parameters<FetchLike>[1] }> = []
    const fetchMock: FetchLike = async (input, init) => {
      requests.push({ input, init })
      return new Response(
        JSON.stringify({
          userId: "u_9JTb4Drw5fbVWpoqM8fwvg",
          email: "alice@example.com",
          displayName: "Alice",
          isAdmin: false,
        }),
        { status: 200 },
      )
    }

    const client = new Client({
      baseUrl: "https://hub.example.com/",
      token: "test-token",
      fetch: fetchMock,
    })

    const result = await client.execute(
      "users_GetDetails",
      {
        userId: "u_9JTb4Drw5fbVWpoqM8fwvg",
      } as Actions["users_GetDetails"]["input"],
    )

    expect(result.email).toBe("alice@example.com")
    expect(requests).toEqual([
      {
        input: "https://hub.example.com/api/v1/actions/invoke/users_GetDetails",
        init: {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: "u_9JTb4Drw5fbVWpoqM8fwvg",
          }),
        },
      },
    ])
  })

  it("raises ActionApiError for non-successful actions", async () => {
    const fetchMock: FetchLike = async () =>
      new Response(
        JSON.stringify({ kind: "Forbidden", message: "Not allowed" }),
        { status: 403 },
      )

    const client = new Client({
      baseUrl: "https://hub.example.com",
      token: "test-token",
      fetch: fetchMock,
    })

    await expect(client.execute("users_Query", {})).rejects.toMatchObject({
      name: "ActionApiError",
      statusCode: 403,
      error: { kind: "Forbidden", message: "Not allowed" },
    } satisfies Partial<ActionApiError>)
  })
})
