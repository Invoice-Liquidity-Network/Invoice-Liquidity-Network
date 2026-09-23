export function SkipNav() {
  return (
    <a
      href="#main-content"
      style={{
        position: 'absolute',
        left: '-9999px',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        zIndex: 9999,
      }}
      onFocus={(e) => {
        e.currentTarget.style.position = 'fixed';
        e.currentTarget.style.top = '8px';
        e.currentTarget.style.left = '8px';
        e.currentTarget.style.width = 'auto';
        e.currentTarget.style.height = 'auto';
        e.currentTarget.style.padding = '12px 20px';
        e.currentTarget.style.background = '#1F2937';
        e.currentTarget.style.color = '#fff';
        e.currentTarget.style.borderRadius = '8px';
        e.currentTarget.style.fontWeight = '700';
        e.currentTarget.style.fontSize = '14px';
        e.currentTarget.style.textDecoration = 'none';
      }}
      onBlur={(e) => {
        e.currentTarget.style.position = 'absolute';
        e.currentTarget.style.left = '-9999px';
        e.currentTarget.style.width = '1px';
        e.currentTarget.style.height = '1px';
      }}
    >
      Skip to main content
    </a>
  );
}
