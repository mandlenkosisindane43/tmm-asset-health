/** Cloudflare Worker entry point for TMM Asset Health. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET?: R2Bucket;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "tmm-asset-health",
        database: Boolean(env.DB),
        storage: Boolean(env.BUCKET),
        images: Boolean(env.IMAGES),
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/_vinext/image") {
      if (!env.IMAGES) {
        console.error("TMM_IMAGE_BINDING_MISSING", { pathname: url.pathname });
        return new Response("Image service is temporarily unavailable.", { status: 503 });
      }
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES!.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    try {
      return await handler.fetch(request, env, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : "UnknownError";
      console.error("TMM_WORKER_RENDER_ERROR", {
        pathname: url.pathname,
        method: request.method,
        name,
        message,
      });
      return new Response("TMM Asset Health is temporarily unavailable. The error has been logged for diagnosis.", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
};

export default worker;
