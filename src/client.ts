import type { Actions } from "./actions"
import {
  invokeDeviceCommand,
  type InvokeDeviceCommandOptions,
  streamDeviceCommand,
  type StreamDeviceCommandOptions,
} from "./commands"
import { ActionApiError } from "./errors"
import type { DeviceCommandDeviceFrame, DeviceCommandDoneData } from "./types/devices"
import type { ActionError } from "./types/errors"

export type FetchLike = (
  input: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: string
  },
) => Promise<Response>

export interface ClientOptions {
  baseUrl: string
  token: string
  fetch?: FetchLike
}

export class Client {
  readonly baseUrl: string
  readonly token: string

  private readonly fetchImpl: FetchLike

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "")
    this.token = options.token
    this.fetchImpl = options.fetch ?? globalFetch
  }

  async execute<A extends keyof Actions>(
    action: A,
    input: Actions[A]["input"],
  ): Promise<Actions[A]["output"]> {
    const response = await this.fetchImpl(this.actionUrl(action), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })

    if (response.ok) {
      return (await response.json()) as Actions[A]["output"]
    }

    throw new ActionApiError(await parseActionError(response), response.status)
  }

  invokeDeviceCommand(
    deviceId: string,
    command: string,
    options: InvokeDeviceCommandOptions = {},
  ): Promise<DeviceCommandDoneData> {
    return invokeDeviceCommand(
      this.baseUrl,
      this.token,
      deviceId,
      command,
      options,
    )
  }

  streamDeviceCommand(
    deviceId: string,
    command: string,
    options: StreamDeviceCommandOptions = {},
  ): AsyncGenerator<DeviceCommandDeviceFrame> {
    return streamDeviceCommand(
      this.baseUrl,
      this.token,
      deviceId,
      command,
      options,
    )
  }

  private actionUrl(action: keyof Actions): string {
    return `${this.baseUrl}/api/v1/actions/invoke/${String(action)}`
  }
}

async function parseActionError(response: Response): Promise<ActionError> {
  try {
    const value = (await response.json()) as Partial<ActionError>
    if (
      typeof value.kind === "string" &&
      typeof value.message === "string"
    ) {
      return value as ActionError
    }
  } catch {
    // Fall through to the generic error below.
  }
  return {
    kind: "Internal",
    message: `request failed with HTTP ${response.status}`,
  }
}

const globalFetch: FetchLike = async (input, init) => {
  if (globalThis.fetch === undefined) {
    throw new Error("global fetch is not available; Node.js 20 or newer is required")
  }
  return globalThis.fetch(input, init)
}
