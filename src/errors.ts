import type { ActionError } from "./types/errors"

export class ActionApiError extends Error {
  readonly error: ActionError
  readonly statusCode: number
  readonly retryAfterSeconds?: number

  constructor(
    error: ActionError,
    statusCode: number,
    retryAfterSeconds?: number,
  ) {
    super(`${error.kind}: ${error.message}`)
    this.name = "ActionApiError"
    this.error = error
    this.statusCode = statusCode
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class CommandInvocationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CommandInvocationError"
  }
}
