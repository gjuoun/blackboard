/** The API's wire shape: {success:true,data} or {success:false,error}. Client fetches unwrap here. */
export function unwrapJson<T>(body: unknown): T {
  if (
    body !== null &&
    typeof body === "object" &&
    (body as { success?: unknown }).success === true &&
    "data" in body
  ) {
    return (body as { data: T }).data;
  }
  return body as T;
}
