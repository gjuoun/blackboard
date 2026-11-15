/**
 * Put `text` on the clipboard. Uses the async Clipboard API in a secure context; otherwise, or when that call
 * is refused, selects a hidden textarea and runs execCommand("copy"), which also works on plain-http LAN
 * addresses and on mobile browsers that refuse the async API. Resolves true when the copy went through.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // refused (no focus or permission): use the textarea below
    }
  }
  return copyWithTextarea(text);
}

function copyWithTextarea(text: string): boolean {
  const selection = document.getSelection();
  const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  area.style.fontSize = "16px"; // keeps iOS from zooming on focus
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  if (saved && selection) {
    selection.removeAllRanges();
    selection.addRange(saved);
  }
  return ok;
}
