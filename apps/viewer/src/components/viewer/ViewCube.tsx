import { useState } from 'react';
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

const FACES = [
  { id: 'front', label: 'FRONT', transform: (h: number) => `translateZ(${h}px)` },
  { id: 'back', label: 'BACK', transform: (h: number) => `translateZ(${-h}px) rotateY(180deg)` },
  { id: 'top', label: 'TOP', transform: (h: number) => `translateY(${-h}px) rotateX(90deg)` },
  { id: 'bottom', label: 'BTM', transform: (h: number) => `translateY(${h}px) rotateX(-90deg)` },
  { id: 'right', label: 'RIGHT', transform: (h: number) => `translateX(${h}px) rotateY(90deg)` },
  { id: 'left', label: 'LEFT', transform: (h: number) => `translateX(${-h}px) rotateY(-90deg)` },
];

export function ViewCube({ onViewChange, rotationX = -25, rotationY = 45 }: ViewCubeProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const size = 60;
  const half = size / 2;

  const handleClick = (face: string) => {
    console.log('[ViewCube] Clicked:', face);
    onViewChange?.(face);
  };

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
        className="relative w-full h-full"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`,
        }}
      >
        {FACES.map(({ id, label, transform }) => (
          <button
            key={id}
            type="button"
            className={cn(
              'absolute w-full h-full flex items-center justify-center text-[10px] font-bold transition-colors cursor-pointer',
              'bg-card/95 border border-border/50',
              hovered === id ? 'bg-primary/30 border-primary text-primary' : 'hover:bg-muted'
            )}
            style={{
              transform: transform(half),
              backfaceVisibility: 'hidden',
            }}
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => handleClick(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export { FACE_VIEWS };
