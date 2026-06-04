"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
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
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
