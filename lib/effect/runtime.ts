import { Layer, ManagedRuntime } from "effect";
import { AppLayer } from "./layers";

/**
 * The one Effect runtime: the SQLite data layer, the repos and the repo-backed stores. Cached on
 * `globalThis` because dev re-evaluates modules on every edit: a runtime per reload leaks a
 * fiber scope per edit, and a runtime per request pays the layer build on every call. The API
 * process and the test suite both run on this; the Next UI reaches the same services over HTTP.
 */
type AppRuntime = ManagedRuntime.ManagedRuntime<Layer.Success<typeof AppLayer>, Layer.Error<typeof AppLayer>>;

const CACHE_KEY = "__blackboard_effect_runtime";
const globals = globalThis as unknown as Record<string, AppRuntime | undefined>;

export const runtime: AppRuntime = globals[CACHE_KEY] ?? ManagedRuntime.make(AppLayer);

globals[CACHE_KEY] = runtime;
