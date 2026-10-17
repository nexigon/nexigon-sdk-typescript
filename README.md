# Nexigon Hub TypeScript SDK

Node.js SDK for the Nexigon Hub public API.

```ts
import { ActionApiError, Client, types } from "@nexigon/hub-sdk"

const client = new Client({
  baseUrl: "https://hub.example.com",
  token: process.env.NEXIGON_TOKEN!,
})

const projects = await client.execute("projects_Query", {
  organizationId: "o_...",
} as types.projects.QueryProjectsAction)
```

Action inputs and outputs are typed through the generated public API action map.
The client authenticates with a Nexigon Hub API token and calls
`/api/v1/actions/invoke/{action}`.

## Action Errors

Action failures throw `ActionApiError`. Rate-limit and temporary-capacity errors
include a `retryAfterSeconds` value derived from `Retry-After`, with the structured
response body as a fallback:

```ts
try {
  await client.execute("projects_Query", { organizationId: "o_..." })
} catch (error) {
  if (
    error instanceof ActionApiError &&
    error.retryAfterSeconds !== undefined
  ) {
    console.error(`Retry after ${error.retryAfterSeconds} seconds`)
  }
}
```

## Device Commands

```ts
const done = await client.invokeDeviceCommand("d_...", "reboot", {
  input: { force: true },
  streamLog: true,
  onLog: (frame) => console.log(frame.lines.join("\n")),
})
```

Clients require HTTPS by default so bearer tokens cannot be sent over an
accidentally plaintext connection. Local development over HTTP requires the explicit
`dangerousAllowPlaintext: true` option.

Device command streaming uses Node WebSockets and sends the same bearer token
on the upgrade request.

The generated API action map and public types are copied from
`frontend/src/api/public` by the repo-level codegen tasks:

```sh
mise run regenerate-ts-api
# or
mise run codegen
```
