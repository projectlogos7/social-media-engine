export class EngineError extends Error {
  constructor(message: string, readonly status = 400, readonly details?: unknown) {
    super(message);
  }
}
export class NotFound extends EngineError {
  constructor(what: string) {
    super(`${what} not found.`, 404);
  }
}
export class Forbidden extends EngineError {
  constructor(message = "You do not have permission to do that.") {
    super(message, 403);
  }
}
