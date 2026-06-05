"use client";

export async function jsonOrError(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || "So‘rov bajarilmadi");
  return data as any;
}
