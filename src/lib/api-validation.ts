import { NextResponse } from "next/server";

export class ApiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiValidationError";
  }
}

export function isApiValidationError(error: unknown): error is ApiValidationError {
  return error instanceof ApiValidationError;
}

export function validationErrorResponse(error: ApiValidationError) {
  return NextResponse.json({ message: error.message }, { status: 400 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
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

export function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiValidationError(`${field} is required`);
  }

  return value;
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ApiValidationError(`${field} must be a string`);
  }

  return value;
}

export function positiveInteger(value: unknown, field: string): number {
  if (value === "" || value === null || value === undefined) {
    throw new ApiValidationError(`${field} must be a positive integer`);
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
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
