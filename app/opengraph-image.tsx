import { ogCard, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "Blackboard — review markdown with your coding agent";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogCard({ title: "Review plans with your coding agent", line: "A local markdown reviewer with comments on the text." });
}
