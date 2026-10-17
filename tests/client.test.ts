import { describe, expect, it } from "vitest";

import { ActionApiError, Client, type Actions, type FetchLike } from "../src";

describe("Client", () => {
  it("executes typed actions with bearer token auth", async () => {
    const requests: Array<{ input: string; init: Parameters<FetchLike>[1] }> =
      [];
    const fetchMock: FetchLike = async (input, init) => {
      requests.push({ input, init });
      return new Response(
        JSON.stringify({
          userId: "u_9JTb4Drw5fbVWpoqM8fwvg",
          email: "alice@example.com",
          displayName: "Alice",
          isAdmin: false,
        }),
        { status: 200 },
      );
    };

    const client = new Client({
      baseUrl: "https://hub.example.com/",
      token: "test-token",
      fetch: fetchMock,
    });

    const result = await client.execute("users_GetDetails", {
      userId: "u_9JTb4Drw5fbVWpoqM8fwvg",
    } as Actions["users_GetDetails"]["input"]);

    expect(result.email).toBe("alice@example.com");
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
    ]);
  });

  it.each([
    {},
    { users: [null] },
    {
      users: [
        {
          userId: "u_example",
          email: "alice@example.com",
          isAdmin: false,
          displayName: null,
        },
      ],
    },
  ])(
    "rejects malformed action responses before returning them: %j",
    async (body) => {
      const client = new Client({
        baseUrl: "https://hub.example.com",
        token: "test-token",
        fetch: async () => new Response(JSON.stringify(body), { status: 200 }),
      });
      await expect(client.execute("users_Query", {})).rejects.toThrow(
        /invalid response for users_Query/,
      );
    },
  );

  it.each([
    { kind: "Unexpected", message: "bad" },
    { kind: "RateLimited", message: "bad", retryAfterSeconds: -1 },
    { kind: "Internal", message: "bad", retryAfterSeconds: null },
  ])("falls back explicitly for malformed action errors: %j", async (body) => {
    const client = new Client({
      baseUrl: "https://hub.example.com",
      token: "test-token",
      fetch: async () => new Response(JSON.stringify(body), { status: 500 }),
    });
    await expect(client.execute("users_Query", {})).rejects.toMatchObject({
      error: {
        kind: "Internal",
        message: "request failed with HTTP 500: invalid action error response",
      },
    });
  });

  it("raises ActionApiError for non-successful actions", async () => {
    const fetchMock: FetchLike = async () =>
      new Response(
        JSON.stringify({ kind: "Forbidden", message: "Not allowed" }),
        { status: 403 },
      );

    const client = new Client({
      baseUrl: "https://hub.example.com",
      token: "test-token",
      fetch: fetchMock,
    });

    await expect(client.execute("users_Query", {})).rejects.toMatchObject({
      name: "ActionApiError",
      statusCode: 403,
      error: { kind: "Forbidden", message: "Not allowed" },
    } satisfies Partial<ActionApiError>);
  });

  it("exposes Retry-After metadata for retryable action errors", async () => {
    const fetchMock: FetchLike = async () =>
      new Response(
        JSON.stringify({
          kind: "Unavailable",
          message: "Service temporarily unavailable",
          retryAfterSeconds: 2,
        }),
        { status: 503, headers: { "Retry-After": "3" } },
      );

    const client = new Client({
      baseUrl: "https://hub.example.com",
      token: "test-token",
      fetch: fetchMock,
    });

    await expect(client.execute("users_Query", {})).rejects.toMatchObject({
      statusCode: 503,
      retryAfterSeconds: 3,
      error: { kind: "Unavailable", retryAfterSeconds: 2 },
    } satisfies Partial<ActionApiError>);
  });

  it("rejects plaintext before invoking fetch", () => {
    let invoked = false;
    expect(
      () =>
        new Client({
          baseUrl: "http://hub.example.com",
          token: "sentinel-token",
          fetch: async () => {
            invoked = true;
            return new Response(null, { status: 200 });
          },
        }),
    ).toThrow(/plaintext HTTP/);
    expect(invoked).toBe(false);
  });

  it("allows an explicit plaintext development connection", async () => {
    const requests: string[] = [];
    const client = new Client({
      baseUrl: "http://127.0.0.1:8080/",
      token: "sentinel-token",
      dangerousAllowPlaintext: true,
      fetch: async (input) => {
        requests.push(input);
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      },
    });

    await client.execute("users_Query", {});
    expect(requests).toEqual([
      "http://127.0.0.1:8080/api/v1/actions/invoke/users_Query",
    ]);
  });

  it.each(["ftp://hub.example.com", "hub.example.com", "/relative"])(
    "rejects unsupported base URL %s",
    (baseUrl) => {
      expect(() => new Client({ baseUrl, token: "sentinel-token" })).toThrow(
        /HTTPS/,
      );
    },
  );
});
