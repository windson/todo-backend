import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { importBundle, parseImportInput } from "@/lib/data-import";

/**
 * POST /api/import
 * Import todos/categories/tags into the AUTHENTICATED user's account. Records
 * are always created for the current user; the payload cannot set another
 * user's id. Validates with Zod and returns a summary {created, skipped,
 * reused, errors}.
 *
 * Accepted inputs:
 * - Content-Type text/csv (or ?format=csv): the raw request body is a flat
 *   todos CSV (as produced by GET /api/export?format=csv).
 * - Content-Type application/json: either a raw bundle object
 *   ({ categories?, tags?, todos? }) or an envelope { format, content } where
 *   `content` is a JSON string or CSV string and `format` is "json"|"csv".
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);

    const { searchParams } = new URL(request.url);
    const queryFormat = searchParams.get("format");
    const contentType = request.headers.get("content-type") ?? "";

    let content: string;
    let format: "json" | "csv";

    if (contentType.includes("text/csv") || queryFormat === "csv") {
      content = await request.text();
      format = "csv";
    } else {
      // JSON path. The body may be a bare bundle, or an envelope that carries a
      // nested string payload with an explicit format (used by the frontend's
      // paste/upload flow so CSV text can travel inside JSON).
      const bodyText = await request.text();
      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        throw ApiError.badRequest("Invalid JSON payload");
      }

      if (
        body &&
        typeof body === "object" &&
        "content" in body &&
        typeof (body as { content: unknown }).content === "string"
      ) {
        const envelope = body as { content: string; format?: unknown };
        content = envelope.content;
        format = envelope.format === "csv" ? "csv" : "json";
      } else {
        content = bodyText;
        format = "json";
      }
    }

    const result = parseImportInput(content, format);
    if ("errors" in result) {
      throw ApiError.badRequest("Import validation failed", result.errors);
    }

    const summary = await importBundle(prisma, userId, result.bundle);
    return successResponse(summary);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
