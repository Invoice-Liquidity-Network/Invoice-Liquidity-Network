import React, { useId } from 'react';

export interface ResponsiveGridProps {
  /** The children nodes (usually cards, list items, etc.) to render in the grid */
  children: React.ReactNode;
  /**
   * Number of columns. Can be a static number or an object mapping breakpoints to column counts.
   * Default: { xs: 1, sm: 2, md: 3, lg: 4 }
   */
  cols?:
    | number
    | {
        xs?: number;
        sm?: number;
        md?: number;
        lg?: number;
        xl?: number;
      };
  /** Spacing between items (e.g. "16px", 20, "1.5rem"). Default: "20px" */
  gap?: number | string;
  /** Custom inline styles for the container */
  style?: React.CSSProperties;
  /** Custom class name */
  className?: string;
}

export const ResponsiveGrid: React.FC<ResponsiveGridProps> = ({
  children,
  cols = { xs: 1, sm: 2, md: 3, lg: 4 },
  gap = '20px',
  style,
  className = '',
}) => {
  const uniqueId = useId().replace(/:/g, '');
  const gridClass = `iln-grid-${uniqueId}`;

  const parsedGap = typeof gap === 'number' ? `${gap}px` : gap;

  // Resolve media query rules
  let cssRules = '';

  if (typeof cols === 'number') {
    cssRules = `
      .${gridClass} {
        grid-template-columns: repeat(${cols}, minmax(0, 1fr));
      }
    `;
  } else {
    const xs = cols.xs ?? 1;
    const sm = cols.sm ?? cols.xs ?? 2;
    const md = cols.md ?? cols.sm ?? 3;
    const lg = cols.lg ?? cols.md ?? 4;
    const xl = cols.xl ?? cols.lg ?? 4;

    cssRules = `
      .${gridClass} {
        grid-template-columns: repeat(${xs}, minmax(0, 1fr));
      }
      @media (min-width: 640px) {
        .${gridClass} {
          grid-template-columns: repeat(${sm}, minmax(0, 1fr));
        }
      }
      @media (min-width: 768px) {
        .${gridClass} {
          grid-template-columns: repeat(${md}, minmax(0, 1fr));
        }
      }
      @media (min-width: 1024px) {
        .${gridClass} {
          grid-template-columns: repeat(${lg}, minmax(0, 1fr));
        }
      }
      @media (min-width: 1280px) {
        .${gridClass} {
          grid-template-columns: repeat(${xl}, minmax(0, 1fr));
        }
      }
    `;
  }

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .${gridClass} {
          display: grid;
          width: 100%;
          box-sizing: border-box;
        }
        ${cssRules}
      `,
        }}
      />
      <div
        className={`${gridClass} ${className}`}
        style={{
          gap: parsedGap,
          ...style,
        }}
      >
        {children}
      </div>
    </>
  );
};
