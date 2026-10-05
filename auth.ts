import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
export const { handlers, auth, signIn, signOut } = NextAuth({
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = z
          .object({
            email: z.email().max(254),
            password: z.string().min(1).max(128),
          })
          .safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();
        const key = createHash("sha256").update(email).digest("hex");
        const allowed = await db.$transaction(async (tx) => {
          await tx.$executeRaw`INSERT INTO "LoginAttempt" ("key","count","windowStart") VALUES (${key},0,NOW()) ON CONFLICT ("key") DO NOTHING`;
          await tx.$queryRaw`SELECT "key" FROM "LoginAttempt" WHERE "key"=${key} FOR UPDATE`;
          const attempt = await tx.loginAttempt.findUniqueOrThrow({
            where: { key },
          });
          if (Date.now() - attempt.windowStart.getTime() > 15 * 60 * 1000) {
            await tx.loginAttempt.update({
              where: { key },
              data: { count: 1, windowStart: new Date() },
            });
            return true;
          }
          if (attempt.count >= 10) return false;
          await tx.loginAttempt.update({
            where: { key },
            data: { count: { increment: 1 } },
          });
          return true;
        });
        if (!allowed) return null;
        const user = await db.user.findUnique({ where: { email } });
        // Always perform a password hash comparison, including unknown accounts.
        const valid = await compare(
          parsed.data.password,
          user?.passwordHash ??
            "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
        );
        if (!user?.active || !valid) {
          if (user)
            await db.auditLog.create({
              data: {
                userId: user.id,
                actorName: user.name,
                actorRole: user.role,
                action: "auth.failed",
                entityId: user.id,
              },
            });
          return null;
        }
        await db.$transaction([
          db.loginAttempt.deleteMany({ where: { key } }),
          db.auditLog.create({
            data: {
              userId: user.id,
              actorName: user.name,
              actorRole: user.role,
              action: "auth.login",
              entityId: user.id,
            },
          }),
        ]);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sessionVersion = user.sessionVersion;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      session.sessionVersion = token.sessionVersion;
      return session;
    },
  },
});
