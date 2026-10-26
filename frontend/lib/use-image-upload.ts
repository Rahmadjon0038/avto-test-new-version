"use client";

import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "./api-authed";

// Admin sahifalardagi rasm yuklash/o'chirish so'rovlari bitta joyda va TanStack Query
// mutatsiyasi sifatida: holat (isPending), xato va qayta urinish bir xil boshqariladi.
export function useImageUpload() {
  const { authFetch } = useAuth();
  const upload = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      jsonOrError(
        await authFetch("/api/upload-image", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        })
      )
  });
  const remove = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      jsonOrError(
        await authFetch("/api/upload-image", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        })
      )
  });
  return { uploadImage: upload.mutateAsync, deleteImage: remove.mutateAsync };
}
