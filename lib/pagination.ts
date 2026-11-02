/**
 * RFC 5988 pagination Link headers for offset/limit list endpoints.
 *
 * Builds `first`, `prev`, `next`, and `last` links (those that apply) from the
 * request URL, the current limit/offset, and the total item count. The links
 * preserve all existing query parameters and only rewrite `limit`/`offset`, so
 * filters and sort order carry over to each page.
 *
 * The header is emitted alongside the existing `X-Total-Count`. Both are
 * CORS-exposed via middleware's Access-Control-Expose-Headers.
 */

export interface PaginationLinkParams {
  /** The full request URL (request.url). */
  url: string;
  /** Items per page actually applied. */
  limit: number;
  /** Zero-based offset actually applied. */
  offset: number;
  /** Total number of matching items (the X-Total-Count value). */
  total: number;
}

/**
 * Produce an RFC 5988 Link header value, or null when there are no relations to
 * emit (e.g. everything fits on one page and there is nothing before/after).
 */
export function buildLinkHeader(params: PaginationLinkParams): string | null {
  const { url, limit, offset, total } = params;
  if (limit <= 0) return null;

  const base = new URL(url);

  const makeLink = (targetOffset: number, rel: string): string => {
    const u = new URL(base.toString());
    u.searchParams.set("limit", String(limit));
    u.searchParams.set("offset", String(Math.max(0, targetOffset)));
    return `<${u.toString()}>; rel="${rel}"`;
  };

  // Offset of the last page start: the largest multiple of `limit` strictly
  // below `total` (0 when total is 0).
  const lastOffset = total > 0 ? Math.floor((total - 1) / limit) * limit : 0;

  const links: string[] = [];

  // first/last always describe the collection bounds.
  links.push(makeLink(0, "first"));
  links.push(makeLink(lastOffset, "last"));

  // prev when there is a page before the current offset.
  if (offset > 0) {
    links.push(makeLink(Math.max(0, offset - limit), "prev"));
  }

  // next when there are more items beyond the current page.
  if (offset + limit < total) {
    links.push(makeLink(offset + limit, "next"));
  }

  return links.length > 0 ? links.join(", ") : null;
}

/**
 * Convenience: build the standard pagination headers (X-Total-Count plus an
 * optional Link) for a list response.
 */
export function paginationHeaders(params: PaginationLinkParams): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Total-Count": String(params.total),
  };
  const link = buildLinkHeader(params);
  if (link) headers.Link = link;
  return headers;
}
