/**
 * Join the REST base WordPress prints (rest_url("alpharecall/v1")) with a
 * route path that may carry its own query string.
 *
 * With pretty permalinks the base is ".../wp-json/alpharecall/v1" and the path
 * is simply appended. With plain permalinks (the WordPress default on a fresh
 * install) it is ".../index.php?rest_route=/alpharecall/v1": the route then
 * lives inside the query, so the path's "?" must become "&", otherwise
 * WordPress reads "/feedback?limit=200" as the route name and answers
 * rest_no_route.
 */
export function restEndpoint(base: string, path: string): string {
  const root = String(base || "").replace(/\/$/, "");
  if (!root.includes("?")) return `${root}${path}`;
  const mark = path.indexOf("?");
  if (mark < 0) return `${root}${path}`;
  return `${root}${path.slice(0, mark)}&${path.slice(mark + 1)}`;
}
