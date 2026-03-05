export function json<T>(data: T, status = 200): Response {
  return Response.json({ success: true, data }, { status });
}

export function error(message: string, code: string, status = 400): Response {
  return Response.json({ success: false, error: { code, message } }, { status });
}

export function paginated<T>(data: T[], total: number, page: number, perPage: number): Response {
  return Response.json({
    success: true,
    data,
    meta: { total, page, per_page: perPage },
  });
}
