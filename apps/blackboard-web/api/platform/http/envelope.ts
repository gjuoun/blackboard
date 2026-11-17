import { Runtime, type Safe } from "@gjuoun/safe-ts";
import type { Context } from "hono";
import type { TypedResponse } from "hono/types";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { JSONParsed } from "hono/utils/types";
import { z } from "zod";
import { HttpFailure } from "./http.failure";

// 失败变体的线格式 = 传输层 status + 派生文案 + 业务字段。catalog 的工厂用
// `status: 404 as const` 把状态钉成字面量（否则 `StatusOf` 拿不到 404，棘轮失效），
// 桥（http.failure.ts）读 status/message，其余字段即出网 details。

/** 失败联合里所有 status，保持字面量（路由 response map 的棘轮靠它）。 */
export type StatusOf<E> = E extends unknown
  ? E[keyof E] extends { readonly status: infer S }
    ? S
    : never
  : never;

// 失败域的形状 = 单键 catalog 变体：`{ TAG: { status, message, ...details } }`。
// 桥（HttpFailure）与 json 都靠它收窄：tag 是键，其余字段是 details。
export type EnvelopeFailure = Record<
  string,
  { readonly status: ContentfulStatusCode; readonly message: string }
>;

export const successEnvelope = z.object({
  success: z.literal(true),
  data: z.unknown(),
});
type SuccessEnvelope<A> = Omit<z.infer<typeof successEnvelope>, "data"> & {
  data: A;
};

export type SuccessEnvelopeSchema<S extends z.ZodType> = ReturnType<
  typeof successEnvelope.extend<{ data: S }>
>;

export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const success = <A>(data: A): SuccessEnvelope<A> => ({
  success: true,
  data,
});

export type JsonResponse<T, S extends ContentfulStatusCode> = Response &
  TypedResponse<JSONParsed<T>, S, "json">;

// 失败按自带 status 进 handler 的联合：路由漏声明任一状态码就不可赋值（棘轮）。
export type JsonExit<A, E extends EnvelopeFailure> =
  | JsonResponse<SuccessEnvelope<A>, 200>
  | JsonResponse<ErrorEnvelope, StatusOf<E>>;

/**
 * handler 的唯一下游：`Runtime.run` 从不 reject，所以这里替 Effect 的 `runPromise + mapError` 干活 ——
 * success → 成功信封；fail → 抛 HttpFailure 交 app.onError；die / interrupt → 同一个 500 出口。
 * 服务在组合根用构造函数装配，所以这里 `R = never`：没有运行时解析，只有一次 Safe 执行。
 */
export async function json<A, E extends EnvelopeFailure>(
  c: Context,
  safe: Safe<A, E>,
): Promise<JsonExit<A, E>> {
  // 客户端断开（或 Hono 中止）就中断这次运行：服务的 `Scheduler.onCancel` 会跟着 abort。
  const exit = await Runtime.run(safe, { signal: c.req.raw.signal });
  if (exit._tag === "success") return c.json(success(exit.value), 200);
  const label = `${c.req.method} ${new URL(c.req.url).pathname}`;
  if (exit._tag === "fail") throw new HttpFailure(exit.error, label);
  throw HttpFailure.defect(exit._tag === "die" ? exit.defect : "safe-ts: run was interrupted", label);
}
