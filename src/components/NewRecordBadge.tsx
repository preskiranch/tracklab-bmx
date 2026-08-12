import { useEffect, useRef, type CSSProperties } from 'react';

export function NewRecordBadge({ style }: { style?: CSSProperties }) {
  const badgeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    badgeRef.current?.animate(
      [{ opacity: 1 }, { opacity: 0.42 }, { opacity: 1 }],
      { duration: 750, iterations: 5 },
    );
  }, []);

  return (
    <span
      ref={badgeRef}
      role="status"
      style={{
        display: 'inline-block',
        padding: '4px 7px',
        borderRadius: '5px',
        background: '#dc2626',
        color: '#fff',
        fontSize: '11px',
        fontWeight: 900,
        textTransform: 'uppercase',
        ...style,
      }}
    >
      New record
    </span>
  );
}
