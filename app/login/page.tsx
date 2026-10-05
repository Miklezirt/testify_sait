import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <form
        className="card"
        action={async (form) => {
          "use server";
          try {
            await signIn("credentials", {
              email: form.get("email"),
              password: form.get("password"),
              redirectTo: "/",
            });
          } catch (e) {
            if (e instanceof AuthError) redirect("/login?error=1");
            throw e;
          }
        }}
      >
        <div className="logo">ROOMS</div>
        <h1>Добро пожаловать</h1>
        <p className="muted">Войдите для управления гостиницей</p>
        {error && (
          <p className="error" role="alert">
            Неверные данные или слишком много попыток. После 10 попыток
            подождите 15 минут.
          </p>
        )}
        <label>
          Email
          <input
            autoComplete="username"
            name="email"
            type="email"
            required
            maxLength={254}
          />
        </label>
        <label>
          Пароль
          <input
            autoComplete="current-password"
            name="password"
            type="password"
            required
            maxLength={128}
          />
        </label>
        <button className="primary">Войти</button>
      </form>
    </main>
  );
}
