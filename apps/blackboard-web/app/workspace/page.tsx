import { permanentRedirect } from "next/navigation";

/** The inbox moved to `/inbox`; this route only exists so old links keep working. */
export default function WorkspaceRedirect() {
  permanentRedirect("/inbox");
}
