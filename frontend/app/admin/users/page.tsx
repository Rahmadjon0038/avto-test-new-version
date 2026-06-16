"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, RefreshCw, Search, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type AdminUser = {
  id: string;
  full_name: string;
  phone: string;
  pro_until: string | null;
  created_at: string | null;
  is_admin: boolean;
  password_reset_required?: boolean;
};

type ResetPasswordResult = {
  user: AdminUser;
  temporaryPassword: string;
  telegramMessage: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uz-UZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export default function AdminUsersPage() {
  const { authFetch } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [resetResult, setResetResult] = useState<ResetPasswordResult | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/users");
      const data = await jsonOrError(res);
      return Array.isArray(data.users) ? data.users : [];
    }
  });

  useEffect(() => {
    if (usersQuery.error) toast.error((usersQuery.error as any)?.message || "Xatolik");
  }, [usersQuery.error]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const users = (usersQuery.data || []) as AdminUser[];
    if (!query) return users;
    return users.filter((user) => {
      const name = String(user.full_name || "").toLowerCase();
      const phone = String(user.phone || "").toLowerCase();
      const id = String(user.id || "").toLowerCase();
      return name.includes(query) || phone.includes(query) || id.includes(query);
    });
  }, [search, usersQuery.data]);

  const totalUsers = (usersQuery.data || []).length;

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await authFetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success("Foydalanuvchi o‘chirildi");
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (user: AdminUser) => {
      const res = await authFetch(`/api/admin/users/${encodeURIComponent(user.id)}/reset-password`, { method: "POST" });
      const data = await jsonOrError(res);
      return {
        user,
        temporaryPassword: String(data.temporaryPassword || ""),
        telegramMessage: String(data.telegramMessage || "")
      };
    },
    onSuccess: async (result) => {
      setResetResult(result);
      toast.success("Vaqtinchalik parol yaratildi");
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error: any) => toast.error(error?.message || "Parol reset qilinmadi")
  });

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch {
      toast.error("Nusxalanmadi");
    }
  }

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <button className="btn btn-ghost" type="button" onClick={() => usersQuery.refetch()} disabled={usersQuery.isFetching}>
          <RefreshCw className="lucide" aria-hidden="true" /> Yangilash
        </button>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Search className="lucide" aria-hidden="true" /> Qidirish
            <span className="badge">{filteredUsers.length}/{totalUsers}</span>
          </div>
        </div>

        <div className="adminSearchWrap">
          <Search className="lucide adminSearchIcon" aria-hidden="true" />
          <input
            className="input adminSearchInput"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ism, telefon yoki ID bo‘yicha qidiring"
          />
          {search ? (
            <button className="adminSearchClear" type="button" onClick={() => setSearch("")} aria-label="Qidiruvni tozalash" title="Tozalash">
              <X className="lucide" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="adminUsersGrid">
        {usersQuery.isLoading ? <div className="muted">Foydalanuvchilar yuklanmoqda...</div> : null}

        {!usersQuery.isLoading && filteredUsers.length === 0 ? (
          <section className="adminEmpty card">
            <div className="adminEmptyTitle">Foydalanuvchi topilmadi</div>
            <div className="adminEmptyText">Qidiruv bo‘yicha hech narsa chiqmayapti.</div>
          </section>
        ) : null}

        {filteredUsers.map((user) => (
          <article className="card adminUserCard" key={user.id}>
            <div className="adminUserTop">
              <div className="adminUserAvatar">
                <UserRound className="lucide" aria-hidden="true" />
              </div>
              <div className="adminUserInfo">
                <div className="adminUserName">{user.full_name || "Ism kiritilmagan"}</div>
                <div className="adminUserMeta">ID: {user.id}</div>
              </div>
              {user.is_admin ? (
                <span className="badge badge-success">
                  <ShieldCheck className="lucide" aria-hidden="true" /> Admin
                </span>
              ) : null}
            </div>

            <div className="adminUserActions">
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => resetPasswordMutation.mutate(user)}
                disabled={resetPasswordMutation.isPending}
                title="Vaqtinchalik parol yaratish"
              >
                <KeyRound className="lucide" aria-hidden="true" /> Reset Password
              </button>
              <button
                className="btn btn-danger btn-sm"
                type="button"
                onClick={() => {
                  if (!window.confirm(`"${user.full_name || user.phone || user.id}" foydalanuvchisini o‘chirishni tasdiqlaysizmi?`)) return;
                  deleteUserMutation.mutate(user.id);
                }}
                disabled={deleteUserMutation.isPending || user.is_admin}
                title={user.is_admin ? "Admin akkauntni o‘chirish mumkin emas" : "O‘chirish"}
              >
                <Trash2 className="lucide" aria-hidden="true" /> O‘chirish
              </button>
            </div>

            <div className="adminUserDetails">
              <div className="adminUserRow">
                <span className="muted">Telefon</span>
                <strong>{user.phone || "—"}</strong>
              </div>
              <div className="adminUserRow">
                <span className="muted">Ro‘yxatdan o‘tgan</span>
                <strong>{formatDate(user.created_at)}</strong>
              </div>
              <div className="adminUserRow">
                <span className="muted">Pro muddati</span>
                <strong>{formatDate(user.pro_until)}</strong>
              </div>
              <div className="adminUserRow">
                <span className="muted">Parol holati</span>
                <strong>{user.password_reset_required ? "Almashtirish talab qilinadi" : "Oddiy"}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
      {resetResult ? (
        <>
          <div className="modalOverlay" onClick={() => setResetResult(null)} />
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div className="modalTitle">Vaqtinchalik parol yaratildi</div>
              <button className="btn btn-ghost" type="button" onClick={() => setResetResult(null)}>
                ✕
              </button>
            </div>
            <div className="modalBody">
              <div className="authResetNotice" style={{ marginTop: 0 }}>
                <div className="authResetTitle">Foydalanuvchi</div>
                <div className="authResetText">{resetResult.user.full_name || resetResult.user.phone || `ID: ${resetResult.user.id}`}</div>
              </div>
              <div className="profileRow profileRowCard">
                <div className="profileKey">
                  <KeyRound className="lucide profileKeyIcon" aria-hidden="true" />
                  Vaqtinchalik parol
                </div>
                <div className="profileVal" style={{ fontSize: 18, letterSpacing: 1 }}>{resetResult.temporaryPassword}</div>
              </div>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => copyText(resetResult.temporaryPassword, "Parol nusxalandi")}
              >
                <Copy className="lucide" aria-hidden="true" /> Parolni nusxalash
              </button>
              <div className="authResetNotice">
                <div className="authResetTitle">Telegram xabar</div>
                <div className="authResetText">{resetResult.telegramMessage}</div>
              </div>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => copyText(resetResult.telegramMessage, "Telegram xabar nusxalandi")}
              >
                <Copy className="lucide" aria-hidden="true" /> Telegram xabarni nusxalash
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
