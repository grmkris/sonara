import { describe, expect, test } from "bun:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  pad,
  parseAbiItem,
} from "viem";
import {
  expectedMinForUsd,
  findUsdcTransfer,
  USDC_BASE,
  type ReceiptLogLike,
} from "./topup-verifier";

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const SENDER = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;

// Build a USDC Transfer log the same shape viem returns from a receipt.
function transferLog({
  contract = USDC_BASE as `0x${string}`,
  from,
  to,
  value,
}: {
  contract?: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
}): ReceiptLogLike {
  const topics = encodeEventTopics({
    abi: [TRANSFER],
    eventName: "Transfer",
    args: { from, to },
  });
  const data = encodeAbiParameters([{ type: "uint256" }], [value]);
  return {
    address: contract,
    data,
    topics: topics as readonly `0x${string}`[],
  };
}

// Random 32-byte non-Transfer log — encoded as a topic + data, just opaque.
function noiseLog(contract: `0x${string}`): ReceiptLogLike {
  return {
    address: contract,
    data: pad("0xdeadbeef", { size: 32 }) as `0x${string}`,
    topics: [pad("0xc0ffee", { size: 32 }) as `0x${string}`],
  };
}

describe("expectedMinForUsd", () => {
  test("converts USD to 6-decimal USDC base units", () => {
    expect(expectedMinForUsd(1)).toBe(1_000_000n);
    expect(expectedMinForUsd(10)).toBe(10_000_000n);
    expect(expectedMinForUsd(100)).toBe(100_000_000n);
  });
});

describe("findUsdcTransfer", () => {
  test("returns paidFrom + paidValue for an exact-amount transfer to recipient", () => {
    const log = transferLog({
      from: SENDER,
      to: RECIPIENT,
      value: 10_000_000n,
    });
    const match = findUsdcTransfer([log], RECIPIENT, 10_000_000n);
    expect(match).not.toBeNull();
    expect(match?.paidFrom).toBe(getAddress(SENDER));
    expect(match?.paidValue).toBe(10_000_000n);
  });

  test("returns the match when overpayment is present (value > min)", () => {
    const log = transferLog({
      from: SENDER,
      to: RECIPIENT,
      value: 12_500_000n,
    });
    const match = findUsdcTransfer([log], RECIPIENT, 10_000_000n);
    expect(match?.paidValue).toBe(12_500_000n);
  });

  test("returns null for underpayment", () => {
    const log = transferLog({
      from: SENDER,
      to: RECIPIENT,
      value: 9_999_999n,
    });
    expect(findUsdcTransfer([log], RECIPIENT, 10_000_000n)).toBeNull();
  });

  test("returns null when transfer goes to a different recipient", () => {
    const log = transferLog({
      from: SENDER,
      to: OTHER,
      value: 10_000_000n,
    });
    expect(findUsdcTransfer([log], RECIPIENT, 10_000_000n)).toBeNull();
  });

  test("ignores Transfer logs from contracts other than USDC", () => {
    const fakeUsdc = "0x4444444444444444444444444444444444444444" as const;
    const log = transferLog({
      contract: fakeUsdc,
      from: SENDER,
      to: RECIPIENT,
      value: 10_000_000n,
    });
    expect(findUsdcTransfer([log], RECIPIENT, 10_000_000n)).toBeNull();
  });

  test("skips noise logs without throwing", () => {
    const noise = noiseLog(USDC_BASE as `0x${string}`);
    const real = transferLog({
      from: SENDER,
      to: RECIPIENT,
      value: 10_000_000n,
    });
    expect(findUsdcTransfer([noise, real], RECIPIENT, 10_000_000n)).not.toBeNull();
  });

  test("returns null on an empty log list", () => {
    expect(findUsdcTransfer([], RECIPIENT, 10_000_000n)).toBeNull();
  });

  test("returns the first matching log when multiple satisfy the criteria", () => {
    const a = transferLog({ from: SENDER, to: RECIPIENT, value: 10_000_000n });
    const b = transferLog({ from: OTHER, to: RECIPIENT, value: 20_000_000n });
    const match = findUsdcTransfer([a, b], RECIPIENT, 10_000_000n);
    expect(match?.paidFrom).toBe(getAddress(SENDER));
    expect(match?.paidValue).toBe(10_000_000n);
  });

  test("recipient address is matched checksum-insensitively", () => {
    // Lowercase recipient — getAddress() normalizes both sides.
    const lower = "0x2222222222222222222222222222222222222222" as `0x${string}`;
    const log = transferLog({
      from: SENDER,
      to: RECIPIENT,
      value: 10_000_000n,
    });
    expect(findUsdcTransfer([log], lower, 10_000_000n)).not.toBeNull();
  });
});
