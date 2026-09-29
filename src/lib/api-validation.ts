import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api-errors";
import { TEXT_LIMITS } from "@/lib/limits";

export { TEXT_LIMITS };

// A malformed request body or parameter. An ApiError like every other
// expected failure, so errorResponse() needs no special case for it.
export class ApiValidationError extends ApiError {
  constructor(message: string, status = 400) {
    super(message, status);
    this.name = "ApiValidationError";
  }
}

export function isApiValidationError(error: unknown): error is ApiValidationError {
  return error instanceof ApiValidationError;
}

export function validationErrorResponse(error: ApiValidationError) {
  return NextResponse.json({ message: error.message }, { status: error.status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiValidationError("Content-Type must be application/json", 415);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ApiValidationError("Malformed JSON body");
  }

  if (!isRecord(body)) {
    throw new ApiValidationError("JSON body must be an object");
  }

  return body;
}

interface StringOptions {
  maxLength?: number;
}

function assertMaxLength(value: string, field: string, maxLength: number | undefined) {
  if (maxLength !== undefined && value.length > maxLength) {
    throw new ApiValidationError(`${field} must be at most ${maxLength} characters`);
  }
}

export function requiredString(
  body: Record<string, unknown>,
  field: string,
  options: StringOptions = {}
): string {
  const value = body[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiValidationError(`${field} is required`);
  }

  assertMaxLength(value, field, options.maxLength);

  return value;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  options: StringOptions = {}
): string | undefined {
  const value = body[field];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ApiValidationError(`${field} must be a string`);
  }

  assertMaxLength(value, field, options.maxLength);

  return value;
}

export function requiredEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  values: readonly T[]
): T {
  const value = body[field];

  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw new ApiValidationError(`${field} must be one of: ${values.join(", ")}`);
  }

  return value as T;
}

export function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  values: readonly T[]
): T | undefined {
  const value = body[field];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return requiredEnum(body, field, values);
}

export function positiveInteger(value: unknown, field: string): number {
  if (value === "" || value === null || value === undefined) {
    throw new ApiValidationError(`${field} must be a positive integer`);
  }

  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    throw new ApiValidationError(`${field} must be a positive integer`);
  }

  return parsed;
}

export function optionalPositiveInteger(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];

  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  return positiveInteger(value, field);
}

export function optionalDateOnly(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];

  if (value === "" || value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiValidationError(`${field} must be a YYYY-MM-DD date`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ApiValidationError(`${field} must be a valid calendar date`);
  }

  return value;
}

export function optionalHttpUrl(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];

  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ApiValidationError(`${field} must be a URL`);
  }

  assertMaxLength(value, field, TEXT_LIMITS.url);

  const trimmed = value.trim();

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ApiValidationError(`${field} must use http or https`);
    }
    return parsed.toString();
  } catch (error) {
    if (isApiValidationError(error)) {
      throw error;
    }
    throw new ApiValidationError(`${field} must be a valid URL`);
  }
}
