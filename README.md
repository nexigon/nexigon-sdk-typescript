# Nexigon Hub TypeScript SDK

Node.js SDK for the Nexigon Hub public API.

```ts
import { Client, types } from "@nexigon/hub-sdk"

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

## Device Commands

```ts
const done = await client.invokeDeviceCommand("d_...", "reboot", {
  input: { force: true },
  streamLog: true,
  onLog: (frame) => console.log(frame.lines.join("\n")),
})
```

Device command streaming uses Node WebSockets and sends the same bearer token
on the upgrade request.

The generated API action map and public types are copied from
`frontend/src/api/public` by the repo-level codegen tasks:

```sh
mise run regenerate-ts-api
# or
mise run codegen
```
