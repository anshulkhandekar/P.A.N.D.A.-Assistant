export const clientId = crypto.randomUUID();
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Projector-Id": clientId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "Request failed");
  return data;
}
