import { useCallback, useState, useRef } from 'react';
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
  const [isAnimating, setIsAnimating] = useState(false);
  const cubeRef = useRef<HTMLDivElement>(null);

  const handleFaceClick = useCallback((face: string) => {
    setIsAnimating(true);
    onViewChange?.(face);
    setTimeout(() => setIsAnimating(false), 300);
  }, [onViewChange]);

  // Handle click based on mouse position relative to cube center
  const handleCubeClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!cubeRef.current) return;
    
    const rect = cubeRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;  // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5;  // -0.5 to 0.5
    
    // Determine which face was clicked based on position
    // Top third = top, bottom third = front/bottom, left/right edges = left/right
    const absX = Math.abs(x);
    const absY = Math.abs(y);
    
    let face: string;
    if (y < -0.25 && absY > absX) {
      face = 'top';
    } else if (y > 0.25 && absY > absX) {
      face = 'front';
    } else if (x < -0.25 && absX > absY) {
      face = 'left';
    } else if (x > 0.25 && absX > absY) {
      face = 'right';
    } else {
      // Center area - use current dominant visible face
      face = 'front';
    }
    
    handleFaceClick(face);
  }, [handleFaceClick]);

  // Track mouse position for hover highlight
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!cubeRef.current) return;
    
    const rect = cubeRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    
    const absX = Math.abs(x);
    const absY = Math.abs(y);
    
    let face: string | null = null;
    if (y < -0.25 && absY > absX) {
      face = 'top';
    } else if (y > 0.25 && absY > absX) {
      face = 'front';
    } else if (x < -0.25 && absX > absY) {
      face = 'left';
    } else if (x > 0.25 && absX > absY) {
      face = 'right';
    }
    
    setHovered(face);
  }, []);

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
        'absolute w-full h-full flex items-center justify-center text-[10px] font-bold transition-colors',
        'bg-card/90 border border-border',
        hovered === face ? 'bg-primary/20 border-primary' : ''
      )}
      style={{ 
        transform, 
        backfaceVisibility: 'hidden',
        pointerEvents: 'none',  // Visual only, click handled by overlay
      }}
    >
      {label}
    </div>
  );

  const size = 60;
  const half = size / 2;

  return (
    <div
      ref={cubeRef}
      className="relative select-none cursor-pointer"
      style={{
        width: size,
        height: size,
        perspective: 200,
      }}
      onClick={handleCubeClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHovered(null)}
    >
      <div
        className={cn(
          'relative w-full h-full pointer-events-none',
          isAnimating && 'transition-transform duration-300'
        )}
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
        className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex gap-3 text-[9px] text-muted-foreground font-medium pointer-events-none"
      >
        <span>N</span>
      </div>
    </div>
  );
}

export { FACE_VIEWS };
