import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { ExportQueryParamsSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { buildExportBundle, bundleToCsv } from "@/lib/data-export";

/**
 * GET /api/export?format=json|csv
 * Download the authenticated user's OWNED todos, categories, and tags as a
 * backup. `format=json` (default) returns a nested bundle; `format=csv` returns
 * a flat todos CSV. Both are returned as a downloadable attachment. Shared-with
 * -me todos are excluded (owned-only scope).
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());

    const parsed = ExportQueryParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid query parameters", parsed.error.issues);
    }

    const format = parsed.data.format ?? "json";
    const bundle = await buildExportBundle(prisma, userId);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      const csv = bundleToCsv(bundle);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="todos-export-${stamp}.csv"`,
        },
      });
    }

    // JSON export is returned raw (not wrapped in the success envelope) so the
    // downloaded file is a clean, re-importable backup bundle.
    return new Response(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="todos-export-${stamp}.json"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
