import { useState } from "react";
import { DocSim } from "./DocSim";
import type { DemoDict } from "./data";
import { InboxSim } from "./InboxSim";

interface Props {
  dict: DemoDict;
}

// Self-contained replica of blackboard-web at <768px: inbox list → doc view. No router, no
// network — the state machine mirrors ReadingWorkspace (selected row, read marks, tab filter).
export default function DemoApp({ dict }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"inbox" | "unread">("inbox");

  const open = (id: string) => {
    setSelectedId(id);
    setReadIds((s) => new Set(s).add(id));
  };

  return (
    <div data-slot="demo-root" className="absolute inset-0 flex flex-col bg-background">
      {selectedId === null ? (
        <InboxSim dict={dict} readIds={readIds} tab={tab} onTab={setTab} onOpen={open} />
      ) : (
        <DocSim dict={dict} onBack={() => setSelectedId(null)} />
      )}
    </div>
  );
}