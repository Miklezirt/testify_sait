"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
type User = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "staff";
  active?: boolean;
};
type Room = {
  id: string;
  name: string;
  capacity: number;
  status: string;
  priceCents: number;
};
type Guest = {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  documents: { id: string; name: string }[];
};
type Payment = {
  id: string;
  amountCents: number;
  method: string;
  kind: string;
  note: string;
  createdAt: string;
};
type Booking = {
  id: string;
  roomId: string;
  guestId: string;
  start: string;
  end: string;
  guestCount: number;
  linen: number;
  totalCents: number;
  notes: string;
  status: string;
  version: number;
  payments: Payment[];
};
type Data = {
  rooms: Room[];
  guests: Guest[];
  bookings: Booking[];
  cleaning: { id: string; roomId: string }[];
  audit: {
    id: string;
    action: string;
    entityId: string;
    createdAt: string;
    user: { name: string };
    actorName: string;
    actorRole: string;
    details: unknown;
  }[];
  users: User[];
  today: string;
};
type Modal = {
  kind: "booking" | "guest" | "room" | "payment" | "user";
  item?: Booking | Guest | Room | User;
  roomId?: string;
  start?: string;
};
const labels: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  staff: "Сотрудник",
  booked: "Забронировано",
  checked_in: "Проживает",
  completed: "Завершено",
  cancelled: "Отменено",
  ready: "Готов",
  cleaning: "Уборка",
  maintenance: "Обслуживание",
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  other: "Другое",
  prepayment: "Предоплата",
  payment: "Оплата",
  refund: "Возврат",
};
const actions: Record<string, string> = {
  "auth.login": "Вход",
  "auth.logout": "Выход",
  "auth.failed": "Неудачный вход",
  "operation.failed": "Отклонённая операция",
  "guest.create": "Создан гость",
  "guest.update": "Изменён гость",
  "room.create": "Создан номер",
  "room.update": "Изменён номер",
  "booking.create": "Создана бронь",
  "booking.update": "Изменена бронь",
  "booking.checked_in": "Заезд",
  "booking.completed": "Выезд",
  "booking.cancelled": "Отмена брони",
  "payment.create": "Принята оплата",
  "payment.refund": "Возврат",
  "cleaning.complete": "Завершена уборка",
  "document.upload": "Загружен документ",
  "document.download": "Скачан документ",
  "document.delete": "Удалён документ",
  "user.create": "Создана учётная запись",
  "user.update": "Изменена учётная запись",
};
const rub = (c: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(
    c / 100,
  );
const iso = (s: string) => s.slice(0, 10);
const plus = (s: string, n: number) =>
  new Date(new Date(s).getTime() + n * 86400000).toISOString().slice(0, 10);
const day = (s: string) =>
  new Date(s).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const paid = (b: Booking) => b.payments.reduce((s, p) => s + p.amountCents, 0);
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}
export default function Dashboard({ user }: { user: User }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null),
    [page, setPage] = useState("Главная"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<Modal | null>(null),
    [calendarStart, setCalendarStart] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [historyGuest, setHistoryGuest] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok) throw Error("Не удалось загрузить данные");
      const d: Data = await res.json();
      setData(d);
      setCalendarStart((s) => s || d.today);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка соединения");
    }
  }, [router]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  async function request(op: string, body: unknown) {
    const res = await fetch("/api/operation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, data: body }),
    });
    const result = await res.json();
    if (!res.ok) throw Error(result.error || "Ошибка операции");
    return result.id as string;
  }
  async function run(op: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await request(op, body);
      setModal(null);
      setNotice("Изменения сохранены");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка соединения");
    } finally {
      setBusy(false);
    }
  }
  function open(m: Modal) {
    setError("");
    setModal(m);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    const f = new FormData(event.currentTarget),
      str = (key: string) => String(f.get(key) ?? ""),
      num = (key: string) => Number(str(key)),
      cents = (key: string) => Math.round(num(key) * 100);
    setBusy(true);
    setError("");
    try {
      if (modal.kind === "booking") {
        let guestId = str("guestId");
        if (!guestId)
          guestId = await request("guest", {
            name: str("guestName"),
            phone: str("phone"),
          });
        const b = modal.item as Booking | undefined;
        await request("booking", {
          id: b?.id,
          version: b?.version,
          roomId: str("roomId"),
          guestId,
          start: str("start"),
          end: str("end"),
          guestCount: num("guestCount"),
          linen: num("linen"),
          totalCents: cents("total"),
          prepaymentCents: b ? 0 : cents("prepayment"),
          method: str("method") || "transfer",
          notes: str("notes"),
        });
      }
      if (modal.kind === "guest")
        await request("guest", {
          id: modal.item?.id,
          name: str("name"),
          phone: str("phone"),
          email: str("email"),
          notes: str("notes"),
        });
      if (modal.kind === "room")
        await request("room", {
          id: modal.item?.id,
          name: str("name"),
          capacity: num("capacity"),
          priceCents: cents("price"),
          status: str("status"),
        });
      if (modal.kind === "payment")
        await request("payment", {
          bookingId: modal.item?.id,
          amountCents: cents("amount"),
          method: str("method"),
          refund: str("refund") === "on",
          note: str("note"),
        });
      if (modal.kind === "user")
        await request("user", {
          id: modal.item?.id,
          name: str("name"),
          email: str("email"),
          role: str("role"),
          active: str("active") === "on",
          password: str("password"),
        });
      setModal(null);
      setNotice("Изменения сохранены");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка соединения");
    } finally {
      setBusy(false);
    }
  }
  async function upload(guestId: string, file: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("guestId", guestId);
      form.set("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const result = await res.json();
      if (!res.ok) throw Error(result.error);
      setNotice("Документ сохранён с закрытым доступом");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  }
  async function removeDoc(id: string) {
    if (!confirm("Удалить документ?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/documents/" + id, { method: "DELETE" });
      if (!res.ok) throw Error("Не удалось удалить документ");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <main>
        <h1>ROOMS</h1>
        <p role="status">{error || "Загрузка гостиницы…"}</p>
        <button onClick={() => void refresh()}>Повторить</button>
      </main>
    );
  const { rooms, guests, bookings, today } = data;
  const room = (id: string) => rooms.find((r) => r.id === id);
  const guest = (id: string) => guests.find((g) => g.id === id);
  const nav = [
    "Главная",
    "Календарь",
    "Бронирования",
    "Гости",
    "Номера",
    "Оплаты",
    "Уборка",
    ...(user.role === "owner" ? ["История", "Учётные записи"] : []),
  ];
  const matches = (b: Booking) =>
    `${guest(b.guestId)?.name} ${room(b.roomId)?.name}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const visible = bookings.filter(
    (b) => matches(b) && (filter === "all" || b.status === filter),
  );
  const days = Array.from({ length: 14 }, (_, i) => plus(calendarStart, i));
  const selectedBooking = modal?.item as Booking | undefined;
  const selectedGuest = modal?.item as Guest | undefined;
  const selectedRoom = modal?.item as Room | undefined;
  const selectedUser = modal?.item as User | undefined;
  function statusButtons(b: Booking) {
    return (
      <div className="actions">
        {b.status === "booked" && (
          <>
            <button
              disabled={busy}
              onClick={() => open({ kind: "booking", item: b })}
            >
              Изменить
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run("status", {
                  id: b.id,
                  version: b.version,
                  status: "checked_in",
                })
              }
            >
              Заезд
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "Отменить бронь? Оплаты остаются в истории. Возврат оформляется отдельно.",
                  )
                )
                  void run("status", {
                    id: b.id,
                    version: b.version,
                    status: "cancelled",
                  });
              }}
            >
              Отменить
            </button>
          </>
        )}
        {b.status === "checked_in" && (
          <>
            <button
              disabled={busy}
              onClick={() => open({ kind: "booking", item: b })}
            >
              Изменить / продлить
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (confirm("Оформить выезд и поставить номер на уборку?"))
                  void run("status", {
                    id: b.id,
                    version: b.version,
                    status: "completed",
                  });
              }}
            >
              Выезд
            </button>
          </>
        )}
        <button
          disabled={busy}
          onClick={() => open({ kind: "payment", item: b })}
        >
          Оплата / возврат
        </button>
      </div>
    );
  }
  const calendar = (
    <>
      <div className="section-title">
        <div>
          <h2>Календарь загрузки</h2>
          <p className="muted">
            Дата выезда свободна для следующей брони. Нажмите дату для создания
            бронирования.
          </p>
        </div>
        <div className="actions">
          <button
            onClick={() => setCalendarStart(plus(calendarStart, -14))}
            aria-label="Предыдущие 14 дней"
          >
            ←
          </button>
          <input
            aria-label="Начало календаря"
            type="date"
            value={calendarStart}
            onChange={(e) => e.target.value && setCalendarStart(e.target.value)}
          />
          <button onClick={() => setCalendarStart(today)}>Сегодня</button>
          <button
            onClick={() => setCalendarStart(plus(calendarStart, 14))}
            aria-label="Следующие 14 дней"
          >
            →
          </button>
        </div>
      </div>
      <div className="calendar">
        <table>
          <thead>
            <tr>
              <th>Номер</th>
              {days.map((d) => (
                <th key={d}>{day(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.name}</b>
                  <br />
                  <span className="muted">
                    {r.capacity} места · {labels[r.status]}
                  </span>
                </td>
                {days.map((d) => {
                  const b = bookings.find(
                    (b) =>
                      b.roomId === r.id &&
                      b.status !== "cancelled" &&
                      iso(b.start) <= d &&
                      iso(b.end) > d,
                  );
                  return (
                    <td
                      key={d}
                      className={b ? b.status : d === today ? r.status : "free"}
                    >
                      {b ? (
                        <button
                          className="cell"
                          onClick={() => {
                            setPage("Бронирования");
                            setSearch(guest(b.guestId)?.name || "");
                            setFilter("all");
                          }}
                        >
                          {guest(b.guestId)?.name}
                          <small>{labels[b.status]}</small>
                        </button>
                      ) : (
                        <button
                          className="cell"
                          disabled={r.status === "maintenance" || d < today}
                          onClick={() =>
                            open({ kind: "booking", roomId: r.id, start: d })
                          }
                        >
                          {d === today && r.status !== "ready"
                            ? labels[r.status]
                            : "Свободно"}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
  return (
    <div className="app">
      <aside>
        <div className="logo">
          ROOMS<small>Управление гостиницей</small>
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n}
              className={page === n ? "active" : ""}
              onClick={() => {
                setPage(n);
                setSearch("");
                setFilter("all");
                setHistoryGuest("");
              }}
            >
              {n}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          {user.name}
          <br />
          {labels[user.role]}
          <button
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              await signOut({ callbackUrl: "/login" });
            }}
          >
            Выйти
          </button>
        </div>
      </aside>
      <main>
        <div className="topbar">
          <div>
            <h1>{page === "Главная" ? `Сегодня, ${day(today)}` : page}</h1>
            <p className="muted">
              {page === "Главная"
                ? "Обзор загрузки гостиничных номеров"
                : "ROOMS · " + labels[user.role]}
            </p>
          </div>
          <div className="actions">
            <button disabled={busy} onClick={() => void refresh()}>
              Обновить
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => open({ kind: "booking" })}
            >
              + Бронирование
            </button>
          </div>
        </div>
        {!modal && error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
            <button
              aria-label="Закрыть сообщение"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </p>
        )}
        {page === "Главная" && (
          <>
            <div className="grid">
              {[
                [
                  "Заезды сегодня",
                  bookings.filter(
                    (b) => iso(b.start) === today && b.status === "booked",
                  ).length,
                ],
                [
                  "Выезды сегодня",
                  bookings.filter(
                    (b) => iso(b.end) <= today && b.status === "checked_in",
                  ).length,
                ],
                [
                  "Свободные номера",
                  rooms.filter(
                    (r) =>
                      r.status === "ready" &&
                      !bookings.some(
                        (b) =>
                          b.roomId === r.id &&
                          (b.status === "checked_in" ||
                            (b.status === "booked" &&
                              iso(b.start) <= today &&
                              iso(b.end) > today)),
                      ),
                  ).length,
                ],
                [
                  "Требуют уборки",
                  rooms.filter((r) => r.status === "cleaning").length,
                ],
              ].map(([title, value]) => (
                <div className="card" key={title}>
                  <div className="muted">{title}</div>
                  <div className="kpi-value">{value}</div>
                </div>
              ))}
            </div>
            {calendar}
            <div className="split">
              <section className="card">
                <h2>Сегодня заезжают</h2>
                {bookings
                  .filter(
                    (b) => iso(b.start) === today && b.status === "booked",
                  )
                  .map((b) => (
                    <div className="row" key={b.id}>
                      <div>
                        <b>{guest(b.guestId)?.name}</b>
                        <p className="muted">{room(b.roomId)?.name}</p>
                      </div>
                      {statusButtons(b)}
                    </div>
                  ))}
              </section>
              <section className="card">
                <h2>Требует внимания</h2>
                {bookings
                  .filter(
                    (b) =>
                      b.status === "checked_in" &&
                      (paid(b) < b.totalCents || iso(b.end) <= today),
                  )
                  .map((b) => (
                    <div className="row" key={b.id}>
                      <div>
                        <b>{guest(b.guestId)?.name}</b>
                        <p>
                          {iso(b.end) <= today ? "Ожидается выезд · " : ""}
                          Остаток {rub(b.totalCents - paid(b))}
                        </p>
                      </div>
                      {statusButtons(b)}
                    </div>
                  ))}
              </section>
            </div>
          </>
        )}
        {page === "Календарь" && calendar}
        {(page === "Бронирования" || page === "Оплаты") && (
          <>
            <div className="toolbar">
              <input
                placeholder="Поиск по гостю или номеру"
                aria-label="Поиск брони"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Статус брони"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">Все статусы</option>
                {["booked", "checked_in", "completed", "cancelled"].map((s) => (
                  <option key={s} value={s}>
                    {labels[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="list">
              {visible.map((b) => (
                <section className="card" key={b.id}>
                  <div className="row">
                    <div>
                      <h2>
                        {guest(b.guestId)?.name} · {room(b.roomId)?.name}
                      </h2>
                      <p className="muted">
                        {day(b.start)} — {day(b.end)} · {b.guestCount} гостей ·{" "}
                        {b.linen} комплектов белья
                      </p>
                    </div>
                    <span className={`status ${b.status}`}>
                      {labels[b.status]}
                    </span>
                  </div>
                  <p>
                    Стоимость {rub(b.totalCents)} · Оплачено {rub(paid(b))} ·{" "}
                    {b.status === "cancelled"
                      ? `К возврату ${rub(paid(b))}`
                      : `Остаток ${rub(b.totalCents - paid(b))}`}
                  </p>
                  {b.notes && <p>{b.notes}</p>}
                  {statusButtons(b)}
                  {page === "Оплаты" && (
                    <div className="payments">
                      {b.payments.map((p) => (
                        <div className="row" key={p.id}>
                          <span>
                            {new Date(p.createdAt).toLocaleString("ru-RU")} ·{" "}
                            {labels[p.kind]} · {labels[p.method]} {p.note}
                          </span>
                          <b>{rub(p.amountCents)}</b>
                        </div>
                      ))}
                      {!b.payments.length && (
                        <p className="muted">Платежей пока нет</p>
                      )}
                    </div>
                  )}
                </section>
              ))}
              {!visible.length && <p className="empty">Бронирований нет</p>}
            </div>
          </>
        )}
        {page === "Гости" && (
          <>
            <div className="toolbar">
              <input
                placeholder="Поиск по имени или телефону"
                aria-label="Поиск гостя"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button onClick={() => open({ kind: "guest" })}>+ Гость</button>
            </div>
            <div className="list">
              {guests
                .filter((g) =>
                  `${g.name} ${g.phone}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((g) => (
                  <section className="card" key={g.id}>
                    <div className="row">
                      <div>
                        <h2>{g.name}</h2>
                        <p className="muted">
                          {g.phone} {g.email}
                        </p>
                      </div>
                      <div className="actions">
                        <button
                          onClick={() => open({ kind: "guest", item: g })}
                        >
                          Изменить
                        </button>
                        <button
                          onClick={() =>
                            setHistoryGuest(historyGuest === g.id ? "" : g.id)
                          }
                        >
                          Проживания (
                          {bookings.filter((b) => b.guestId === g.id).length})
                        </button>
                      </div>
                    </div>
                    {g.notes && <p>{g.notes}</p>}
                    {historyGuest === g.id &&
                      bookings
                        .filter((b) => b.guestId === g.id)
                        .map((b) => (
                          <div className="row" key={b.id}>
                            <span>
                              {room(b.roomId)?.name} · {day(b.start)} —{" "}
                              {day(b.end)} · {labels[b.status]}
                            </span>
                            <span>
                              {rub(b.totalCents)} · оплачено {rub(paid(b))}
                            </span>
                          </div>
                        ))}
                    {user.role !== "staff" && (
                      <div className="documents">
                        <h3>Закрытые документы</h3>
                        {g.documents.map((d) => (
                          <div className="actions" key={d.id}>
                            <a href={"/api/documents/" + d.id}>{d.name}</a>
                            <button
                              disabled={busy}
                              onClick={() => void removeDoc(d.id)}
                            >
                              Удалить
                            </button>
                          </div>
                        ))}
                        <label className="muted">
                          Добавить PDF / JPEG / PNG до 5 МБ
                          <input
                            type="file"
                            accept="application/pdf,image/jpeg,image/png"
                            disabled={busy}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void upload(g.id, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </section>
                ))}
            </div>
          </>
        )}
        {page === "Номера" && (
          <>
            <div className="toolbar">
              {user.role !== "staff" && (
                <button onClick={() => open({ kind: "room" })}>+ Номер</button>
              )}
            </div>
            <div className="grid">
              {rooms.map((r) => (
                <section className="card" key={r.id}>
                  <h2>{r.name}</h2>
                  <p>
                    {r.capacity} места · {rub(r.priceCents)} / ночь
                  </p>
                  <p>
                    <span className={`status ${r.status}`}>
                      {labels[r.status]}
                    </span>
                  </p>
                  {user.role !== "staff" && (
                    <button onClick={() => open({ kind: "room", item: r })}>
                      Изменить
                    </button>
                  )}
                </section>
              ))}
            </div>
          </>
        )}
        {page === "Уборка" && (
          <div className="list">
            {data.cleaning.map((t) => (
              <section className="card row" key={t.id}>
                <div>
                  <h2>{room(t.roomId)?.name}</h2>
                  <p className="muted">Подготовить номер к следующему заезду</p>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void run("clean", { id: t.id })}
                >
                  Уборка завершена
                </button>
              </section>
            ))}
            {!data.cleaning.length && (
              <p className="empty">Все номера убраны</p>
            )}
          </div>
        )}
        {page === "История" && (
          <>
            <p className="muted">
              Последние 200 событий. Полный журнал сохраняется в базе без
              удаления и доступен через экспорт.
            </p>
            <div className="toolbar">
              <input
                placeholder="Поиск по сотруднику или действию"
                aria-label="Поиск в журнале"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <a className="button" href="/api/audit">
                Экспорт полного журнала CSV
              </a>
            </div>
            <div className="calendar">
              <table>
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Пользователь</th>
                    <th>Действие</th>
                    <th>Запись</th>
                    <th>Подробности</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit
                    .filter((a) =>
                      `${a.actorName || a.user.name} ${actions[a.action] || a.action}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((a) => (
                      <tr key={a.id}>
                        <td>{new Date(a.createdAt).toLocaleString("ru-RU")}</td>
                        <td>
                          {a.actorName || a.user.name}
                          <small> · {labels[a.actorRole]}</small>
                        </td>
                        <td>{actions[a.action] || a.action}</td>
                        <td>{a.entityId}</td>
                        <td>
                          <details>
                            <summary>Показать</summary>
                            <pre>{JSON.stringify(a.details, null, 2)}</pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {page === "Учётные записи" && (
          <>
            <button onClick={() => open({ kind: "user" })}>
              + Учётная запись
            </button>
            <div className="list mt">
              {data.users.map((u) => (
                <section className="card row" key={u.id}>
                  <div>
                    <h2>{u.name}</h2>
                    <p>
                      {u.email} · {labels[u.role]} ·{" "}
                      {u.active ? "Активен" : "Отключён"}
                    </p>
                  </div>
                  <button onClick={() => open({ kind: "user", item: u })}>
                    Изменить / сменить пароль
                  </button>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
      <dialog
        ref={dialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setModal(null);
        }}
        onClose={() => !busy && setModal(null)}
      >
        <form onSubmit={save}>
          <div className="topbar">
            <h2>
              {modal?.kind === "booking"
                ? selectedBooking
                  ? "Изменить бронь"
                  : "Новое бронирование"
                : modal?.kind === "guest"
                  ? "Гость"
                  : modal?.kind === "room"
                    ? "Номер"
                    : modal?.kind === "payment"
                      ? "Оплата / возврат"
                      : "Учётная запись"}
            </h2>
            <button
              type="button"
              aria-label="Закрыть"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              ×
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-grid" key={modal?.kind + ":" + modal?.item?.id}>
            {modal?.kind === "booking" && (
              <>
                <Field label="Номер">
                  <select
                    name="roomId"
                    required
                    defaultValue={
                      selectedBooking?.roomId || modal.roomId || rooms[0]?.id
                    }
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} · {r.capacity} места
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Количество гостей">
                  <input
                    name="guestCount"
                    type="number"
                    min="1"
                    max="100"
                    required
                    defaultValue={selectedBooking?.guestCount || 1}
                  />
                </Field>
                <Field label="Дата заезда">
                  <input
                    name="start"
                    type="date"
                    required
                    min={
                      selectedBooking?.status === "checked_in"
                        ? iso(selectedBooking.start)
                        : today
                    }
                    defaultValue={
                      selectedBooking
                        ? iso(selectedBooking.start)
                        : modal.start || today
                    }
                  />
                </Field>
                <Field label="Дата выезда">
                  <input
                    name="end"
                    type="date"
                    required
                    defaultValue={
                      selectedBooking
                        ? iso(selectedBooking.end)
                        : plus(modal.start || today, 1)
                    }
                  />
                </Field>
                <Field label="Гость из справочника">
                  <select
                    name="guestId"
                    defaultValue={selectedBooking?.guestId || ""}
                  >
                    <option value="">Создать нового гостя ниже</option>
                    {guests.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} · {g.phone}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ФИО нового гостя">
                  <input
                    name="guestName"
                    maxLength={200}
                    placeholder="Если гостя нет в справочнике"
                  />
                </Field>
                <Field label="Телефон нового гостя">
                  <input name="phone" maxLength={40} />
                </Field>
                <Field label="Комплектов белья">
                  <input
                    name="linen"
                    type="number"
                    min="0"
                    defaultValue={selectedBooking?.linen || 0}
                  />
                </Field>
                <Field label="Стоимость, ₽">
                  <input
                    name="total"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    defaultValue={
                      selectedBooking ? selectedBooking.totalCents / 100 : 0
                    }
                  />
                </Field>
                {!selectedBooking && (
                  <>
                    <Field label="Предоплата, ₽">
                      <input
                        name="prepayment"
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={0}
                      />
                    </Field>
                    <Field label="Способ предоплаты">
                      <select name="method">
                        {["transfer", "cash", "card", "other"].map((m) => (
                          <option key={m} value={m}>
                            {labels[m]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </>
                )}
                <Field label="Комментарий">
                  <textarea
                    name="notes"
                    maxLength={2000}
                    defaultValue={selectedBooking?.notes}
                  />
                </Field>
              </>
            )}
            {modal?.kind === "guest" && (
              <>
                <Field label="ФИО">
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={200}
                    defaultValue={selectedGuest?.name}
                  />
                </Field>
                <Field label="Телефон">
                  <input
                    name="phone"
                    maxLength={40}
                    defaultValue={selectedGuest?.phone}
                  />
                </Field>
                <Field label="Email">
                  <input
                    name="email"
                    type="email"
                    defaultValue={selectedGuest?.email}
                  />
                </Field>
                <Field label="Комментарий">
                  <textarea
                    name="notes"
                    maxLength={2000}
                    defaultValue={selectedGuest?.notes}
                  />
                </Field>
              </>
            )}
            {modal?.kind === "room" && (
              <>
                <Field label="Название">
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={selectedRoom?.name}
                  />
                </Field>
                <Field label="Вместимость">
                  <input
                    name="capacity"
                    required
                    type="number"
                    min="1"
                    max="100"
                    defaultValue={selectedRoom?.capacity || 2}
                  />
                </Field>
                <Field label="Цена за ночь, ₽">
                  <input
                    name="price"
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={(selectedRoom?.priceCents || 0) / 100}
                  />
                </Field>
                <Field label="Статус">
                  <select
                    name="status"
                    defaultValue={selectedRoom?.status || "ready"}
                  >
                    {["ready", "cleaning", "maintenance"].map((s) => (
                      <option key={s} value={s}>
                        {labels[s]}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {modal?.kind === "payment" && (
              <>
                <p className="full">
                  {guest(selectedBooking!.guestId)?.name} · Оплачено{" "}
                  {rub(paid(selectedBooking!))} · Остаток{" "}
                  {rub(selectedBooking!.totalCents - paid(selectedBooking!))}
                </p>
                <Field label="Сумма, ₽">
                  <input
                    name="amount"
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                  />
                </Field>
                <Field label="Способ оплаты">
                  <select name="method">
                    {["transfer", "cash", "card", "other"].map((m) => (
                      <option key={m} value={m}>
                        {labels[m]}
                      </option>
                    ))}
                  </select>
                </Field>
                {user.role === "owner" && (
                  <label className="check">
                    <input type="checkbox" name="refund" /> Возврат
                  </label>
                )}
                <Field label="Комментарий">
                  <input name="note" maxLength={2000} />
                </Field>
              </>
            )}
            {modal?.kind === "user" && (
              <>
                <Field label="Имя">
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    defaultValue={selectedUser?.name}
                  />
                </Field>
                <Field label="Email — логин">
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="off"
                    defaultValue={selectedUser?.email}
                  />
                </Field>
                <Field
                  label={
                    selectedUser
                      ? "Новый пароль (пусто — оставить текущий)"
                      : "Пароль"
                  }
                >
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required={!selectedUser}
                    minLength={12}
                    maxLength={128}
                  />
                </Field>
                <Field label="Уровень доступа">
                  <select
                    name="role"
                    defaultValue={selectedUser?.role || "staff"}
                  >
                    {["owner", "admin", "staff"].map((r) => (
                      <option key={r} value={r}>
                        {labels[r]}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={selectedUser?.active ?? true}
                  />{" "}
                  Активен
                </label>
              </>
            )}
          </div>
          <div className="modal-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              Отмена
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
