import type { Review } from "@/lib/comments-store";

/** A round's review: a card at the end of the anchored comments. Its only verdict is `commented`. */
export function ReviewCard({ review }: { review: Review }) {
  return (
    <li className="border-border bg-card rounded-xl border p-3 text-[13px]" data-testid="review-card" data-round={review.round} data-verdict={review.verdict}>
      <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
        <span className="text-foreground font-medium">{review.author}</span>
        <span>·</span>
        <span>Round {review.round} review</span>
        <span className="bg-primary-soft text-primary ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold">{review.verdict}</span>
      </div>
      <p className="m-0 whitespace-pre-wrap">{review.body}</p>
    </li>
  );
}
