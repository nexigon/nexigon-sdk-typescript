import { once } from "node:events"
import type { AddressInfo, IncomingMessage } from "node:http"

import { WebSocketServer, type WebSocket } from "ws"
import { describe, expect, it } from "vitest"

import {
  buildCommandWebSocketUrl,
  buildInvokeFrame,
  Client,
  CommandInvocationError,
  parseDeviceFrame,
} from "../src"

const token = "test-token"
const deviceId = "d_9JTb4Drw5fbVWpoqM8fwvg"

describe("device commands", () => {
  it("builds WebSocket URLs from HTTP base URLs", () => {
    expect(buildCommandWebSocketUrl("http://host:8180", deviceId)).toBe(
      `ws://host:8180/api/v1/connect/command/${deviceId}`,
    )
    expect(
      buildCommandWebSocketUrl("https://hub.example.com/some/prefix", deviceId),
    ).toBe(`wss://hub.example.com/api/v1/connect/command/${deviceId}`)
  })

  it("serializes Invoke frames using camelCase fields", () => {
    expect(
      JSON.parse(
        buildInvokeFrame("reboot", {
          input: { force: true },
          streamLog: true,
          timeoutSecs: 30,
        }),
      ),
    ).toEqual({
      type: "Invoke",
      command: "reboot",
      input: { force: true },
      streamLog: true,
      timeoutSecs: 30,
    })
  })

  it("parses and rejects device frames", () => {
    expect(parseDeviceFrame(JSON.stringify({ type: "Log", lines: ["hello"] })))
      .toEqual({ type: "Log", lines: ["hello"] })
    expect(
      parseDeviceFrame(
        JSON.stringify({
          type: "Done",
          status: "Ok",
          output: { exitCode: 0 },
          logTail: ["tail"],
          durationMs: 42,
        }),
      ),
    ).toMatchObject({ type: "Done", status: "Ok", durationMs: 42 })

    expect(() =>
      parseDeviceFrame(JSON.stringify({ type: "Nonsense" })),
    ).toThrow(CommandInvocationError)
  })

  it("invokes a device command over a real WebSocket server", async () => {
    const receivedInvoke: unknown[] = []

    await withCommandServer((ws, request) => {
      expect(request.url).toBe(`/api/v1/connect/command/${deviceId}`)
      expect(request.headers.authorization).toBe(`Bearer ${token}`)
      ws.once("message", (data) => {
        receivedInvoke.push(JSON.parse(data.toString()))
        ws.send(JSON.stringify({ type: "Log", lines: ["starting"] }))
        ws.send(JSON.stringify({ type: "Log", lines: ["working"] }))
        ws.send(
          JSON.stringify({
            type: "Done",
            status: "Ok",
            output: { result: "done" },
            logTail: ["starting", "working"],
            durationMs: 123,
          }),
        )
      })
    }, async (baseUrl) => {
      const client = new Client({ baseUrl, token })
      const logs: string[][] = []
      const done = await client.invokeDeviceCommand(deviceId, "reboot", {
        input: { force: true },
        streamLog: true,
        onLog: (frame) => {
          logs.push(frame.lines)
        },
      })

      expect(receivedInvoke).toEqual([
        {
          type: "Invoke",
          command: "reboot",
          input: { force: true },
          streamLog: true,
        },
      ])
      expect(logs).toEqual([["starting"], ["working"]])
      expect(done).toEqual({
        status: "Ok",
        output: { result: "done" },
        logTail: ["starting", "working"],
        durationMs: 123,
      })
    })
  })

  it("streams all frames until Done", async () => {
    await withCommandServer((ws) => {
      ws.once("message", () => {
        ws.send(JSON.stringify({ type: "Log", lines: ["one"] }))
        ws.send(
          JSON.stringify({
            type: "Done",
            status: "Error",
            error: "boom",
            logTail: ["one"],
            durationMs: 5,
          }),
        )
      })
    }, async (baseUrl) => {
      const client = new Client({ baseUrl, token })
      const frames = []
      for await (const frame of client.streamDeviceCommand(deviceId, "noop")) {
        frames.push(frame)
      }

      expect(frames).toHaveLength(2)
      expect(frames[0]).toMatchObject({ type: "Log", lines: ["one"] })
      expect(frames[1]).toMatchObject({ type: "Done", status: "Error" })
    })
  })

  it("raises when the command stream closes before Done", async () => {
    await withCommandServer((ws) => {
      ws.once("message", () => {
        ws.send(JSON.stringify({ type: "Log", lines: ["partial"] }))
        ws.close()
      })
    }, async (baseUrl) => {
      const client = new Client({ baseUrl, token })
      await expect(
        client.invokeDeviceCommand(deviceId, "noop"),
      ).rejects.toThrow(CommandInvocationError)
    })
  })
})

async function withCommandServer(
  onConnection: (ws: WebSocket, request: IncomingMessage) => void,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = new WebSocketServer({ port: 0 })
  server.on("connection", onConnection)
  await once(server, "listening")

  const { port } = server.address() as AddressInfo
  try {
    await callback(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }
}
