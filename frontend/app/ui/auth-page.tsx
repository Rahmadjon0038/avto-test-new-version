"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Eye, EyeOff, KeyRound, LogIn, UserPlus, UserRound } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type Tab = "register" | "login";

function formatUzLocalPhone(value: string) {
  const digits = normalizeUzLocalDigits(value);
  const p1 = digits.slice(0, 2);
  const p2 = digits.slice(2, 5);
  const p3 = digits.slice(5, 7);
  const p4 = digits.slice(7, 9);
  const parts = [];
  if (p1) parts.push(p1);
  if (p2) parts.push(p2);
  if (p3) parts.push(p3);
  if (p4) parts.push(p4);
  return parts.join("-");
}

function uzLocalDigits(value: string) {
  return normalizeUzLocalDigits(value);
}

function normalizeUzLocalDigits(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.startsWith("998") ? digits.slice(3) : digits;
  return local.slice(0, 9);
}

export default function AuthPage() {
  const router = useRouter();
  const { setAccessToken, setUser, authReady, accessToken } = useAuth();
  const [tab, setTab] = useState<Tab>("login");
  const [fullName, setFullName] = useState("");
  const [phoneRegisterLocal, setPhoneRegisterLocal] = useState("");
  const [passwordRegister, setPasswordRegister] = useState("");
  const [phoneLoginLocal, setPhoneLoginLocal] = useState("");
  const [passwordLogin, setPasswordLogin] = useState("");
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (authReady && accessToken) router.replace("/app");
  }, [authReady, accessToken, router]);

  function switchTab(nextTab: Tab) {
    toast.dismiss();
    setTab(nextTab);
  }

  const registerMutation = useMutation({
    mutationFn: (payload: { fullName: string; phone: string; password: string }) =>
      fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(jsonOrError),
    onSuccess: (data: any) => {
      if (data?.accessToken) setAccessToken(String(data.accessToken));
      if (data?.user) setUser(data.user);
      // auto login
      toast.success("Ro‘yxatdan o‘tildi");
      router.push("/app");
    },
    onError: (e: any) => toast.error(e?.message || "Xatolik")
  });

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const rawFullName = String(formData.get("fullName") || fullName);
    const rawPhone = String(formData.get("phone") || phoneRegisterLocal);
    const rawPassword = String(formData.get("password") || passwordRegister);
    const phoneDigits = uzLocalDigits(rawPhone);

    if (!rawFullName.trim()) return toast.error("Ism kiritilishi kerak");
    if (phoneDigits.length !== 9) return toast.error("Telefon raqam formati noto‘g‘ri");
    if (rawPassword.length < 6) return toast.error("Kamida 6 ta belgidan iborat parol yarating");

    registerMutation.mutate({
      fullName: rawFullName.trim(),
      phone: `+998${phoneDigits}`,
      password: rawPassword
    });
  }

  const loginMutation = useMutation({
    mutationFn: (payload: { phone: string; password: string }) =>
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(jsonOrError),
    onSuccess: (data: any) => {
      if (data?.accessToken) setAccessToken(String(data.accessToken));
      if (data?.user) setUser(data.user);
      toast.success("Kirish muvaffaqiyatli");
      router.push("/app");
    },
    onError: (e: any) => toast.error(e?.message || "Xatolik")
  });

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const rawPhone = String(formData.get("phone") || phoneLoginLocal);
    const rawPassword = String(formData.get("password") || passwordLogin);
    const phoneDigits = uzLocalDigits(rawPhone);

    if (phoneDigits.length !== 9) return toast.error("Telefon raqam formati noto‘g‘ri");
    if (!rawPassword) return toast.error("Parolni kiriting");

    loginMutation.mutate({ phone: `+998${phoneDigits}`, password: rawPassword });
  }

  return (
    <>
      <header className="navbar">
        <div className="navbarInner">
          <div className="brand">
            <div className="logo">JA</div>
            <div className="title">Jo‘rabek Avto Test</div>
          </div>
          <div className="navCenter" />
          <div className="actions" />
        </div>
      </header>

      <main className="container authContainer">
        <div className="authShell">
          <section className="card authCardSimple">
            <div className="authTabs" role="tablist" aria-label="Auth tabs">
              <button type="button" className={`authTab ${tab === "login" ? "active" : ""}`} onClick={() => switchTab("login")} aria-pressed={tab === "login"}>
                <LogIn className="lucide" aria-hidden="true" />
                Tizimga kirish
              </button>
              <button
                type="button"
                className={`authTab ${tab === "register" ? "active" : ""}`}
                onClick={() => switchTab("register")}
                aria-pressed={tab === "register"}
              >
                <UserPlus className="lucide" aria-hidden="true" />
                Ro‘yxatdan o‘tish
              </button>
            </div>

            {tab === "register" ? (
              <form className="formGrid authForm" onSubmit={onRegister}>
                <div>
                  <div className="fieldLabel">F.I.O</div>
                  <div className="inputGroup authInputGroup noRight">
                    <span className="inputAddon">
                      <UserRound className="lucide" aria-hidden="true" />
                    </span>
                    <input
                      name="fullName"
                      className="input inputField"
                      placeholder="To‘liq ism"
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <div className="fieldLabel">Telefon raqam</div>
                  <div className="inputGroup authInputGroup inputPhone noRight">
                    <span className="inputAddon inputAddonText">+998</span>
                    <input
                      name="phone"
                      className="input inputField"
                      placeholder="97-212-00-38"
                      autoComplete="tel"
                      inputMode="tel"
                      value={formatUzLocalPhone(phoneRegisterLocal)}
                      onChange={(e) => setPhoneRegisterLocal(uzLocalDigits(e.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <div className="fieldLabel">Parol</div>
                  <div className="inputGroup authInputGroup">
                    <span className="inputAddon">
                      <KeyRound className="lucide" aria-hidden="true" />
                    </span>
                    <input
                      name="password"
                      className="input inputField"
                      type={showPass ? "text" : "password"}
                      placeholder="Kamida 6 ta belgi"
                      autoComplete="new-password"
                      value={passwordRegister}
                      onChange={(e) => setPasswordRegister(e.target.value)}
                    />
                    <button className="inputIconBtn" type="button" onClick={() => setShowPass((v) => !v)} aria-label="Show password">
                      {showPass ? <EyeOff className="lucide" aria-hidden="true" /> : <Eye className="lucide" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <button className="btn btn-primary authSubmitBtn" type="submit" disabled={registerMutation.isPending}>
                  Ro‘yxatdan o‘tish
                </button>
              </form>
            ) : (
              <form className="formGrid authForm" onSubmit={onLogin}>
                <div>
                  <div className="fieldLabel">Telefon raqam</div>
                  <div className="inputGroup authInputGroup inputPhone noRight">
                    <span className="inputAddon inputAddonText">+998</span>
                    <input
                      name="phone"
                      className="input inputField"
                      placeholder="97-212-00-38"
                      autoComplete="tel"
                      inputMode="tel"
                      value={formatUzLocalPhone(phoneLoginLocal)}
                      onChange={(e) => setPhoneLoginLocal(uzLocalDigits(e.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <div className="fieldLabel">Parol</div>
                  <div className="inputGroup authInputGroup">
                    <span className="inputAddon">
                      <KeyRound className="lucide" aria-hidden="true" />
                    </span>
                    <input
                      name="password"
                      className="input inputField"
                      type={showPass ? "text" : "password"}
                      placeholder="Parol"
                      autoComplete="current-password"
                      value={passwordLogin}
                      onChange={(e) => setPasswordLogin(e.target.value)}
                    />
                    <button className="inputIconBtn" type="button" onClick={() => setShowPass((v) => !v)} aria-label="Show password">
                      {showPass ? <EyeOff className="lucide" aria-hidden="true" /> : <Eye className="lucide" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <button className="btn btn-primary authSubmitBtn" type="submit" disabled={loginMutation.isPending}>
                  Kirish
                </button>
              </form>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
