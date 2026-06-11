"use client";

import { dodopaymentsClient } from "@dodopayments/better-auth";
import { createAuthClient } from "better-auth/react";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? undefined : window.location.origin,
  plugins: [dodopaymentsClient()],
});

const { useSession: _useSession, signOut } = authClient;

const useSession = () => {
  const session = _useSession();
  return session as typeof session & {
    data:
      | (typeof session.data & {
          user: SessionUser;
        })
      | null;
  };
};

export { useSession, signOut };
