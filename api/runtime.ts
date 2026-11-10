import { Layer, ManagedRuntime } from "effect";
import { ApiLayer } from "../lib/effect/api-layer";

/**
 * The API process runtime, built from ApiLayer: the SQLite data layer and its repos, the file
 * lock and the platform file system. Cached on globalThis so a re-evaluated module does not
 * leak a fiber scope per reload.
 */
export { ApiLayer };

type ApiRuntime = ManagedRuntime.ManagedRuntime<Layer.Success<typeof ApiLayer>, Layer.Error<typeof ApiLayer>>;

const CACHE_KEY = "__blackboard_api_runtime";
const globals = globalThis as unknown as Record<string, ApiRuntime | undefined>;

export const runtime: ApiRuntime = globals[CACHE_KEY] ?? ManagedRuntime.make(ApiLayer);

globals[CACHE_KEY] = runtime;
