import { Layer, ManagedRuntime } from "effect";

/**
 * The app's one Effect runtime. Layers stay empty this round: the stores are still plain
 * functions, so there is no service to provide yet. When they become services, their layer
 * goes here and nowhere else.
 *
 * It is cached on `globalThis` because dev re-evaluates modules on every edit: a runtime per
 * reload leaks a fiber scope per edit, and a runtime per request pays the layer build on every
 * call. The cache key is a plain string, so a second copy of this module maps to the same one.
 */
type AppRuntime = ManagedRuntime.ManagedRuntime<never, never>;

const CACHE_KEY = "__blackboard_effect_runtime";
const globals = globalThis as unknown as Record<string, AppRuntime | undefined>;

export const runtime: AppRuntime = globals[CACHE_KEY] ?? ManagedRuntime.make(Layer.empty);

globals[CACHE_KEY] = runtime;
