import { NextRequest } from "next/server";

const backendUrl =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:4001";

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
    // Backend o'zi aniq Cache-Control (masalan, ETag bilan "no-cache") bersa — o'shani saqlaymiz,
    // aks holda hamma narsa no-store bo'lib, brauzer hech narsani qayta ishlatolmaydi.
    if (!response.headers.get("cache-control")) {
      responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }

    // 204/304 javoblarda tana bo'lishi mumkin emas (Response konstruktori xato beradi).
    if (response.status === 204 || response.status === 304) {
      return new Response(null, { status: response.status, headers: responseHeaders });
    }

    if (!response.ok && !response.headers.get("content-type")) {
      return new Response(JSON.stringify({ error: `Upstream xatosi: ${response.status}` }), {
        status: response.status,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error: any) {
    return Response.json(
      {
        error: error?.message || "API proxy xatosi"
      },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;
