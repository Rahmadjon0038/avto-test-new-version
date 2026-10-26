// Oxirgi muvaffaqiyatli javobni localStorage'da saqlaydi, shunda ro'yxat sahifalari keyingi
// kirishda internetni kutmasdan darhol chiziladi (stale-while-revalidate). React Query'ning
// `placeholderData` bilan ishlatiladi: haqiqiy javob kelgach, u almashtiradi.
const PREFIX = "topshirdi_pc_v1:";

export function readPersisted<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function writePersisted(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Kvota to'lgan yoki storage o'chirilgan — jim o'tkazib yuboramiz.
  }
}

// Chiqishda (logout) foydalanuvchiga bog'liq ro'yxat nusxalarini tozalaydi.
export function clearPersisted(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // storage mavjud emas
  }
}
