import worker from "./router";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const response = await worker.fetch(request, env as never, ctx);
    const url = new URL(request.url);

    if (request.method !== "GET" || url.pathname !== "/contractor") return response;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return response;

    let body = await response.text();

    // Slightly larger company logo on desktop.
    body = body.replace(
      "width:132px;max-width:132px;height:103px",
      "width:146px;max-width:146px;height:114px",
    );

    // Slightly larger company logo on narrow/mobile sidebar.
    body = body.replace(
      "width:120px;max-width:120px;height:94px",
      "width:132px;max-width:132px;height:103px",
    );

    // Lighter active/hover rounded menu tile while preserving brand green.
    body = body.replace(
      ".side nav a.active,.side nav a:hover{background:#0a7a49}",
      ".side nav a.active,.side nav a:hover{background:#11975c}",
    );

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
