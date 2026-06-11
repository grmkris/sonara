"use client";

// Custom native drag preview: up to three stacked thumbnails with a count
// badge — replaces the browser's raw <img> snapshot. Mounted into
// pragmatic's preview container via createRoot (see set-frame-tile).
export const FrameDragPreview = ({
  urls,
  count,
}: {
  urls: string[];
  count: number;
}) => (
  <div className="relative h-20 w-20">
    {urls.slice(0, 3).map((url, i) => (
      <img
        key={url}
        src={url}
        alt=""
        className="absolute size-16 rounded-sm border border-[color:var(--hairline)]/60 bg-[color:var(--ink)] object-cover"
        style={{
          left: i * 4,
          top: i * 4,
          transform: `rotate(${(i - 1) * 2}deg)`,
          zIndex: 3 - i,
        }}
      />
    ))}
    {count > 1 && (
      <span className="absolute -right-1 -top-1 z-10 flex min-w-5 items-center justify-center rounded-sm bg-[color:var(--signal)] px-1 py-0.5 font-mono text-[9px] text-[color:var(--paper)]">
        {count}
      </span>
    )}
  </div>
);
