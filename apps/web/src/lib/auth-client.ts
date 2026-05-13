"use client";

import { createAuthClient } from "better-auth/react";
import { dodopaymentsClient } from "@dodopayments/better-auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined" ? window.location.origin : undefined,
  plugins: [dodopaymentsClient()],
});

const { useSession: _useSession, signOut } = authClient;

function useSession() {
  const session = _useSession();
  return session as typeof session & {
    data: typeof session.data & {
      user: SessionUser;
    } | null;
  };
}

export { useSession, signOut };
