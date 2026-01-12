import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

interface ViewCubeProps {
  onViewChange?: (view: string) => void;
  rotationX?: number;
  rotationY?: number;
}

const FACE_VIEWS: Record<string, { rx: number; ry: number }> = {
  front: { rx: 0, ry: 0 },
  back: { rx: 0, ry: 180 },
  top: { rx: -90, ry: 0 },
  bottom: { rx: 90, ry: 0 },
  right: { rx: 0, ry: -90 },
  left: { rx: 0, ry: 90 },
};

export function ViewCube({ onViewChange, rotationX = -25, rotationY = 45 }: ViewCubeProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const handleFaceClick = useCallback((face: string) => {
    onViewChange?.(face);
  }, [onViewChange]);

  const Face = ({
    face,
    label,
    transform
  }: {
    face: string;
    label: string;
    transform: string
  }) => (
    <div
      className={cn(
        'absolute w-full h-full flex items-center justify-center text-[10px] font-bold cursor-pointer transition-colors',
        'bg-card/90 border border-border',
        hovered === face ? 'bg-primary/20 border-primary' : 'hover:bg-muted'
      )}
      style={{ transform, backfaceVisibility: 'hidden' }}
      onMouseEnter={() => setHovered(face)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => handleFaceClick(face)}
    >
      {label}
    </div>
  );

  const size = 60;
  const half = size / 2;

  return (
    <div
      className="relative select-none"
      style={{
        width: size,
        height: size,
        perspective: 200,
      }}
    >
      <div
        className="relative w-full h-full transition-transform duration-300"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`,
        }}
      >
        {/* Front */}
        <Face face="front" label="FRONT" transform={`translateZ(${half}px)`} />

        {/* Back */}
        <Face face="back" label="BACK" transform={`translateZ(${-half}px) rotateY(180deg)`} />

        {/* Top */}
        <Face face="top" label="TOP" transform={`translateY(${-half}px) rotateX(90deg)`} />

        {/* Bottom */}
        <Face face="bottom" label="BTM" transform={`translateY(${half}px) rotateX(-90deg)`} />

        {/* Right */}
        <Face face="right" label="RIGHT" transform={`translateX(${half}px) rotateY(90deg)`} />

        {/* Left */}
        <Face face="left" label="LEFT" transform={`translateX(${-half}px) rotateY(-90deg)`} />
      </div>

      {/* Compass Ring */}
      <div
        className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex gap-3 text-[9px] text-muted-foreground font-medium"
      >
        <span>N</span>
      </div>
    </div>
  );
}

export { FACE_VIEWS };
