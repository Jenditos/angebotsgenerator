import type { NextApiRequest, NextApiResponse } from "next";

export function buildWebRequestFromApiRequest(
  req: NextApiRequest,
  overrideUrl?: string,
): Request {
  const headers = new Headers();

  Object.entries(req.headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
      return;
    }

    if (typeof value === "string") {
      headers.set(key, value);
    }
  });

  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol =
    typeof forwardedProto === "string" && forwardedProto.trim()
      ? forwardedProto.trim()
      : "http";
  const host = req.headers.host || "localhost:3003";
  const url =
    overrideUrl ||
    `${protocol}://${host}${req.url || "/"}`;
  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : JSON.stringify(req.body);

  return new Request(url, {
    method: req.method,
    headers,
    body,
  });
}

export async function sendWebResponseToApiResponse(
  response: Response,
  res: NextApiResponse,
) {
  const buffer = Buffer.from(await response.arrayBuffer());

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") {
      return;
    }

    res.setHeader(key, value);
  });

  res.status(response.status).send(buffer);
}
