import { createStart } from "@tanstack/react-start";
import { guard } from "~/lib/guard";

export const startInstance = createStart(() => ({ requestMiddleware: [guard] }));
export default startInstance;