import { auth } from "@/auth";
import { db } from "@/lib/db";
export async function currentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return db.user.findFirst({
    where: {
      id: session.user.id,
      active: true,
      sessionVersion: session.sessionVersion ?? 0,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      sessionVersion: true,
    },
  });
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.AUTH_URL || new URL(request.url).origin;
  return origin === new URL(expected).origin;
}
