import { U32 } from "@sidex/types";
import WebSocket, { type RawData } from "ws";

import { CommandInvocationError } from "./errors";
import {
  DeviceCommandDeviceFrame,
  DeviceCommandDoneData,
  DeviceCommandHubFrame,
  DeviceCommandLogData,
} from "./types/devices";
import type { JsonValue } from "./types/json";

export interface InvokeDeviceCommandOptions {
  input?: JsonValue;
  streamLog?: boolean;
  timeoutSecs?: number;
  onLog?: (
    frame: { type: "Log" } & DeviceCommandLogData,
  ) => void | Promise<void>;
}

export interface StreamDeviceCommandOptions {
  input?: JsonValue;
  streamLog?: boolean;
  timeoutSecs?: number;
}

export function buildCommandWebSocketUrl(
  baseUrl: string,
  deviceId: string,
): string {
  const url = new URL(baseUrl);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else {
    throw new Error(`unsupported base URL scheme: ${url.protocol}`);
  }
  url.pathname = `/api/v1/connect/command/${encodeURIComponent(deviceId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildInvokeFrame(
  command: string,
  options: StreamDeviceCommandOptions = {},
): string {
  const frame: DeviceCommandHubFrame = {
    type: "Invoke",
    command,
    input: options.input ?? null,
    streamLog: options.streamLog,
    timeoutSecs:
      options.timeoutSecs === undefined
        ? undefined
        : U32.fromNumber(options.timeoutSecs),
  };
  return JSON.stringify(frame);
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function parseDeviceFrame(text: string): DeviceCommandDeviceFrame {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CommandInvocationError(
      `received malformed device command frame: ${formatError(error)}`,
    );
  }

  if (!DeviceCommandDeviceFrame.is(value)) {
    throw new CommandInvocationError(
      `received malformed device command frame: ${DeviceCommandDeviceFrame.check(value)}`,
    );
  }
  return value;
}

export async function invokeDeviceCommand(
  baseUrl: string,
  token: string,
  deviceId: string,
  command: string,
  options: InvokeDeviceCommandOptions = {},
): Promise<DeviceCommandDoneData> {
  for await (const frame of streamDeviceCommand(
    baseUrl,
    token,
    deviceId,
    command,
    options,
  )) {
    if (frame.type === "Log" && options.onLog !== undefined) {
      await options.onLog(frame);
    }
    if (frame.type === "Done") {
      const { type: _type, ...data } = frame;
      return data;
    }
  }
  throw new CommandInvocationError(
    "connection closed before receiving a Done frame",
  );
}

export async function* streamDeviceCommand(
  baseUrl: string,
  token: string,
  deviceId: string,
  command: string,
  options: StreamDeviceCommandOptions = {},
): AsyncGenerator<DeviceCommandDeviceFrame> {
  const url = buildCommandWebSocketUrl(baseUrl, deviceId);
  const ws = new WebSocket(url, { headers: authHeaders(token) });

  try {
    await waitForOpen(ws);
    const queue = createMessageQueue(ws);
    ws.send(buildInvokeFrame(command, options));

    while (true) {
      const message = await queue.next();
      if (message === undefined) {
        return;
      }
      if (message.isBinary) {
        continue;
      }
      const frame = parseDeviceFrame(rawDataToString(message.data));
      yield frame;
      if (frame.type === "Done") {
        return;
      }
    }
  } catch (error) {
    if (error instanceof CommandInvocationError) {
      throw error;
    }
    throw new CommandInvocationError(`websocket error: ${formatError(error)}`);
  } finally {
    if (
      ws.readyState === WebSocket.CONNECTING ||
      ws.readyState === WebSocket.OPEN
    ) {
      ws.close();
    }
  }
}

function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      ws.off("open", onOpen);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new CommandInvocationError("websocket closed before opening"));
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

interface QueuedMessage {
  data: RawData;
  isBinary: boolean;
}

function createMessageQueue(ws: WebSocket) {
  const messages: QueuedMessage[] = [];
  const waiters: Array<() => void> = [];
  let closed = false;
  let error: Error | undefined;

  const wake = () => {
    const waiter = waiters.shift();
    waiter?.();
  };

  ws.on("message", (data, isBinary) => {
    messages.push({ data, isBinary });
    wake();
  });
  ws.once("error", (cause) => {
    error = cause instanceof Error ? cause : new Error(String(cause));
    wake();
  });
  ws.once("close", () => {
    closed = true;
    wake();
  });

  return {
    async next(): Promise<QueuedMessage | undefined> {
      while (messages.length === 0) {
        if (error !== undefined) {
          throw error;
        }
        if (closed) {
          return undefined;
        }
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
      return messages.shift();
    },
  };
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return data.toString("utf8");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
