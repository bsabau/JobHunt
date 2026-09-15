import { NextResponse } from "next/server";
import { isApiValidationError, validationErrorResponse } from "@/lib/api-validation";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Conflict") {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export class InvalidInputError extends ApiError {
  constructor(message = "Invalid input") {
    super(message, 400);
    this.name = "InvalidInputError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function errorResponse(error: unknown, fallbackMessage: string) {
  if (isApiValidationError(error)) {
    return validationErrorResponse(error);
  }

  if (isApiError(error)) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }

  console.error(error);
  return NextResponse.json({ message: fallbackMessage }, { status: 500 });
}
