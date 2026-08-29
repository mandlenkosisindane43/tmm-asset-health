import legacyWorker from "./index";
import { handleContractorLive, type ContractorEnv } from "./contractor-live";

interface Env extends ContractorEnv {
  ASSETS: Fetcher;
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const contractor = await handleContractorLive(request, env);
    if (contractor) return contractor;
    return legacyWorker.fetch(request, env, ctx);
  },
};
