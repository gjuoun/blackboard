"use client";

import { useActionState } from "react";
import { createBoard, type NewBoardState } from "@/app/actions";

export function NewBoardForm() {
  const [state, action, pending] = useActionState<NewBoardState, FormData>(createBoard, { error: null, topic: "" });
  return (
    <form action={action} className="new-board">
      <input
        name="topic"
        data-testid="new-board-name"
        placeholder="New board topic, e.g. MAF connected rewards"
        defaultValue={state.topic}
        required
        maxLength={120}
      />
      <button type="submit" data-testid="new-board-submit" className="primary" disabled={pending}>
        {pending ? "Creating…" : "New board"}
      </button>
      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  );
}
