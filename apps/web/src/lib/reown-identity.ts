const IDENTITY_API = "https://rpc.walletconnect.org/v1/identity";

export interface ReownIdentity {
  name: string | null;
  avatar: string | null;
}

// Resolves an Ethereum address to a display name + avatar via Reown's
// Identity API. Aggregates ENS, CCIP-read offchain names (Coinbase *.cb.id),
// and Reown profile names in one call. Never throws — returns nulls so
// callers can fall back.
export async function fetchReownIdentity(
  address: string,
): Promise<ReownIdentity> {
  const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID;
  if (!projectId) return { name: null, avatar: null };
  try {
    const url = `${IDENTITY_API}/${address}?projectId=${projectId}&chainId=eip155:1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return { name: null, avatar: null };
    const data = (await res.json()) as {
      name?: string | null;
      avatar?: string | null;
    };
    const name = data.name && data.name !== "" ? data.name : null;
    const avatar = data.avatar && data.avatar !== "" ? data.avatar : null;
    return { name, avatar };
  } catch {
    return { name: null, avatar: null };
  }
}
