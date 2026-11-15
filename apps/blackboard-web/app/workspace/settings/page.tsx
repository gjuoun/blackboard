import { permanentRedirect } from "next/navigation";

/** Settings moved to `/inbox/settings`. */
export default function WorkspaceSettingsRedirect() {
  permanentRedirect("/inbox/settings");
}
