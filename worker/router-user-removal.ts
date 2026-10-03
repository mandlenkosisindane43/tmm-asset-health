import currentApp from "./router-operational-alerts-sms";
import { removeUser, enhanceUsersPage } from "./company-user-removal";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime: number; cron: string; noRetry(): void; }
interface Env { DB: D1Database; [key: string]: unknown; }

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method === "POST" && path === "/company-admin/users/remove")
      return removeUser(req, env);

    let response = await currentApp.fetch(req, env as never, ctx as never);
    response = await enhanceUsersPage(req, env, response);
    return response;
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    return currentApp.scheduled(controller as never, env as never, ctx as never);
  },
};
