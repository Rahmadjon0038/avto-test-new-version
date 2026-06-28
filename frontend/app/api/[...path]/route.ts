import { NextRequest } from "next/server";

const backendUrl =
  process.env.BACKEND_URL ||
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:4000" : "https://api.topshirdi.uz");

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  try {
    const params = await context.params;
    const segments = Array.isArray(params.path) ? params.path : [];
    const targetUrl = new URL(`/api/${segments.map(encodeURIComponent).join("/")}`, backendUrl);
    targetUrl.search = request.nextUrl.search;

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("connection");
    headers.delete("content-length");

    const hasBody = !["GET", "HEAD"].includes(request.method);
    const body = hasBody ? await request.arrayBuffer() : undefined;

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual"
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("transfer-encoding");
    responseHeaders.delete("content-length");

    if (response.ok) {
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      });
    }

    const errorText = await response.text().catch(() => "");
    return new Response(
      errorText || JSON.stringify({ error: `Upstream xatosi: ${response.status}` }),
      {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") || "application/json"
        }
      }
    );
  } catch (error: any) {
    return Response.json(
      {
        error: error?.message || "API proxy xatosi"
      },
      { status: 500 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;
