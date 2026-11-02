import { Layer, ManagedRuntime } from "effect";
import { AppLayer } from "./layers";

/**
 * The app one Effect runtime. It is built from AppLayer, so every route, server component and CLI
 * command that asks for a service gets the same instance.
 *
 * It is cached on `globalThis` because dev re-evaluates modules on every edit: a runtime per
 * reload leaks a fiber scope per edit, and a runtime per request pays the layer build on every
 * call. The cache key is a plain string, so a second copy of this module maps to the same one.
 */
type AppRuntime = ManagedRuntime.ManagedRuntime<Layer.Success<typeof AppLayer>, Layer.Error<typeof AppLayer>>;

const CACHE_KEY = "__blackboard_effect_runtime";
const globals = globalThis as unknown as Record<string, AppRuntime | undefined>;

export const runtime: AppRuntime = globals[CACHE_KEY] ?? ManagedRuntime.make(AppLayer);

globals[CACHE_KEY] = runtime;