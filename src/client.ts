import { ActionOutputs, type Actions } from "./actions";
import {
  invokeDeviceCommand,
  type InvokeDeviceCommandOptions,
  streamDeviceCommand,
  type StreamDeviceCommandOptions,
} from "./commands";
import { ActionApiError } from "./errors";
import type {
  DeviceCommandDeviceFrame,
  DeviceCommandDoneData,
} from "./types/devices";
import { ActionError } from "./types/errors";

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<Response>;

export interface ClientOptions {
  baseUrl: string;
  token: string;
  fetch?: FetchLike;
  /** Permit credentials over HTTP on an explicitly trusted development network. */
  dangerousAllowPlaintext?: boolean;
}

export class Client {
  readonly baseUrl: string;
  readonly token: string;

  private readonly fetchImpl: FetchLike;

  constructor(options: ClientOptions) {
    this.baseUrl = validatedBaseUrl(
      options.baseUrl,
      options.dangerousAllowPlaintext ?? false,
    );
    this.token = options.token;
    this.fetchImpl = options.fetch ?? globalFetch;
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
    });

    if (response.ok) {
      const value: unknown = await response.json();
      const checker = ActionOutputs[action];
      if (!checker.is(value)) {
        throw new Error(
          `received invalid response for ${action}: ${checker.check(value)}`,
        );
      }
      return value;
    }

    const error = await parseActionError(response);
    throw new ActionApiError(
      error,
      response.status,
      parseRetryAfter(response) ?? parseRetrySeconds(error.retryAfterSeconds),
    );
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
    );
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
    );
  }

  private actionUrl(action: keyof Actions): string {
    return `${this.baseUrl}/api/v1/actions/invoke/${String(action)}`;
  }
}

function validatedBaseUrl(baseUrl: string, allowPlaintext: boolean): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTPS URL");
  }
  if (url.protocol === "http:" && !allowPlaintext) {
    throw new TypeError(
      "refusing to send a Nexigon token over plaintext HTTP; set dangerousAllowPlaintext only for a trusted development network",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("baseUrl must use HTTPS");
  }
  return baseUrl.replace(/\/+$/, "");
}

async function parseActionError(response: Response): Promise<ActionError> {
  try {
    const value: unknown = await response.json();
    if (ActionError.is(value)) return value;
  } catch {
    // Fall through to the generic error below.
  }
  return {
    kind: "Internal",
    message: `request failed with HTTP ${response.status}: invalid action error response`,
  };
}

function parseRetryAfter(response: Response): number | undefined {
  return parseRetrySeconds(response.headers.get("Retry-After"));
}

function parseRetrySeconds(value: unknown): number | undefined {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+$/.test(String(value))
  ) {
    return undefined;
  }
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

const globalFetch: FetchLike = async (input, init) => {
  if (globalThis.fetch === undefined) {
    throw new Error(
      "global fetch is not available; Node.js 20.19+ (20.x) or 22.12+ is required",
    );
  }
  return globalThis.fetch(input, init);
};
