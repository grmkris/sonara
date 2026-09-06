// oxlint-disable promise/avoid-new, eslint/no-await-in-loop -- REVIEW: IndexedDB is event-based; chunk reads/uploads are sequential to bound memory
import { TakeManifest } from "@sonara/shared";
import type { FrameSetId } from "@sonara/shared/typeid";

import { rpcClient } from "@/lib/orpc";

export type ChunkKind = "video" | "audio" | "events" | "masks" | "images";
export interface LocalTake {
  counts: Record<ChunkKind, number>;
  manifest: TakeManifest;
  recording: boolean;
  remix?: boolean;
  setId?: FrameSetId;
}
export interface TakeChunk {
  blob: Blob;
  id: string;
  index: number;
  kind: ChunkKind;
}
let database: Promise<IDBDatabase> | null = null;
const open = (): Promise<IDBDatabase> => {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("sonara-takes", 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore("takes", { keyPath: "manifest.id" });
      request.result.createObjectStore("chunks", {
        keyPath: ["id", "kind", "index"],
      });
    });
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      database = null;
      reject(request.error);
    });
  });
  return database;
};
const result = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error);
    });
  });
const committed = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => {
      resolve();
    });
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new Error("Recording storage failed."));
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error);
    });
  });
export const saveLocalTake = async (take: LocalTake): Promise<void> => {
  const db = await open();
  const tx = db.transaction("takes", "readwrite");
  tx.objectStore("takes").put(take);
  await committed(tx);
};
export const listLocalTakes = async (): Promise<LocalTake[]> => {
  const db = await open();
  return result(db.transaction("takes").objectStore("takes").getAll());
};
export const readLocalTake = async (
  id: string
): Promise<LocalTake | undefined> => {
  const db = await open();
  return result(db.transaction("takes").objectStore("takes").get(id));
};
export const appendChunk = async (
  take: LocalTake,
  kind: ChunkKind,
  blob: Blob
): Promise<void> => {
  const db = await open();
  const index = take.counts[kind];
  const tx = db.transaction(["takes", "chunks"], "readwrite");
  tx.objectStore("chunks").put({
    blob,
    id: take.manifest.id,
    index,
    kind,
  } satisfies TakeChunk);
  const next = { ...take, counts: { ...take.counts, [kind]: index + 1 } };
  tx.objectStore("takes").put(next);
  await committed(tx);
  take.counts[kind] = index + 1;
};
export const readChunk = async (
  id: string,
  kind: ChunkKind,
  index: number
): Promise<TakeChunk> => {
  const db = await open();
  const chunk = await result<TakeChunk | undefined>(
    db.transaction("chunks").objectStore("chunks").get([id, kind, index])
  );
  if (!chunk) {
    throw new Error(`Recording chunk ${kind}/${index} is missing.`);
  }
  return chunk;
};
export const takeBlob = async (
  take: LocalTake,
  kind: ChunkKind
): Promise<Blob> => {
  const parts: Blob[] = [];
  for (let index = 0; index < take.counts[kind]; index += 1) {
    const chunk = await readChunk(take.manifest.id, kind, index);
    parts.push(chunk.blob);
  }
  return new Blob(parts, {
    type: parts[0]?.type ?? "application/octet-stream",
  });
};
export const downloadBlob = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
};
const toBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
};
export const uploadTake = async (
  take: LocalTake,
  progress: (value: number) => void
): Promise<FrameSetId> => {
  const { setId } = await rpcClient.takes.begin({
    clientId: take.manifest.id,
    name: take.manifest.name.slice(0, 120),
    remix: take.remix ?? false,
  });
  take.setId = setId;
  await saveLocalTake(take);
  const saved = await rpcClient.takes.get({ setId });
  if (saved.manifest) {
    progress(1);
    return setId;
  }
  const total = Object.values(take.counts).reduce((a, b) => a + b, 0);
  let done = 0;
  for (const kind of ["video", "audio", "events", "masks", "images"] as const) {
    for (let index = 0; index < take.counts[kind]; index += 1) {
      const { blob } = await readChunk(take.manifest.id, kind, index);
      await rpcClient.takes.chunk({
        contentType: blob.type,
        data: await toBase64(blob),
        index,
        kind,
        setId,
      });
      done += 1;
      progress(done / Math.max(1, total));
    }
  }
  await rpcClient.takes.finalize({
    counts: take.counts,
    manifest: take.manifest,
    setId,
  });
  return setId;
};
export const fetchTake = async (setId: FrameSetId): Promise<LocalTake> => {
  const { chunks, manifest, remix } = await rpcClient.takes.get({ setId });
  if (!manifest) {
    throw new Error("This take is still being uploaded.");
  }
  const parsed = TakeManifest.parse(manifest);
  const existing = await readLocalTake(parsed.id);
  if (
    existing &&
    Object.values(existing.counts).reduce((a, b) => a + b, 0) === chunks.length
  ) {
    const cached = { ...existing, manifest: parsed, remix, setId };
    await saveLocalTake(cached);
    return cached;
  }
  const take: LocalTake = {
    counts: { audio: 0, events: 0, images: 0, masks: 0, video: 0 },
    manifest: parsed,
    recording: false,
    remix,
    setId,
  };
  await saveLocalTake(take);
  for (const chunk of chunks) {
    const response = await fetch(chunk.url);
    if (!response.ok) {
      throw new Error("A recording chunk could not be downloaded.");
    }
    await appendChunk(
      take,
      chunk.kind,
      new Blob([await response.blob()], { type: chunk.contentType })
    );
  }
  return take;
};
