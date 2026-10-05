import "next-auth";
import "next-auth/jwt";
declare module "next-auth" {
  interface User {
    sessionVersion?: number;
  }
  interface Session {
    sessionVersion?: number;
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    sessionVersion?: number;
  }
}
