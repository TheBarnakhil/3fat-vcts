import { NextResponse } from "next/server";

export class HttpError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public details?: unknown,
	) {
		super(message);
	}
}

export function badRequest(message: string, details?: unknown): HttpError {
	return new HttpError(400, "bad_request", message, details);
}
export function unauthorized(message = "Authentication required"): HttpError {
	return new HttpError(401, "unauthorized", message);
}
export function forbidden(message = "Forbidden"): HttpError {
	return new HttpError(403, "forbidden", message);
}
export function conflict(message = "Conflict"): HttpError {
	return new HttpError(409, "conflict", message);
}
export function notFound(message = "Not found"): HttpError {
	return new HttpError(404, "not_found", message);
}
export function tooMany(message = "Too many requests"): HttpError {
	return new HttpError(429, "too_many_requests", message);
}
export function serverError(message = "Internal error"): HttpError {
	return new HttpError(500, "internal_error", message);
}
export function serviceUnavailable(message = "Service unavailable"): HttpError {
	return new HttpError(503, "service_unavailable", message);
}

export function toResponse(err: unknown): NextResponse {
	if (err instanceof HttpError) {
		return NextResponse.json(
			{ error: { code: err.code, message: err.message, details: err.details } },
			{ status: err.status },
		);
	}
	console.error("[unhandled]", err);
	return NextResponse.json(
		{ error: { code: "internal_error", message: "Internal error" } },
		{ status: 500 },
	);
}
