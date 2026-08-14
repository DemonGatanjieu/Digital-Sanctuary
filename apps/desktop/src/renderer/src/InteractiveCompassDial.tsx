import { useEffect, useRef, useState, useCallback } from "react";
import type { ActiveTheme } from "@sanctuary/domain";

export interface InteractiveCompassDialProps {
  mode?: "hero" | "floating" | "compact";
  className?: string;
  onThemeSwitch?: (themeId: string) => void;
}

interface SectorInfo {
  id: string;
  name: string;
  angle: number; // in degrees: 0 = North, 90 = East, 180 = South, 270 = West
  symbol: string;
  color: string;
}

const SECTORS: SectorInfo[] = [
  { id: "default", name: "蔚蓝", angle: 0, symbol: "N · 晨曦", color: "#0284c7" },
  { id: "builtin.hollow-zero", name: "绝区", angle: 90, symbol: "E · 空洞", color: "#ffd200" },
  { id: "builtin.sakura-dream", name: "樱梦", angle: 180, symbol: "S · 梦境", color: "#ff5e97" },
  { id: "builtin.cyber-deck", name: "赛博", angle: 270, symbol: "W · 矩阵", color: "#00f0ff" }
];

export function InteractiveCompassDial({
  mode = "hero",
  className = "",
  onThemeSwitch
}: InteractiveCompassDialProps) {
  const dialRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [activeSectorId, setActiveSectorId] = useState<string>("default");
  const [tilt, setTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Physics state refs
  const dragStartAngle = useRef<number>(0);
  const dialStartRotation = useRef<number>(0);
  const lastAngle = useRef<number>(0);
  const velocity = useRef<number>(0);
  const animFrameId = useRef<number | null>(null);
  const isInteracting = useRef<boolean>(false);

  // Sync with current active theme
  useEffect(() => {
    window.sanctuary.getActiveTheme().then((active) => {
      setActiveSectorId(active.themeId);
      const matched = SECTORS.find((s) => s.id === active.themeId);
      if (matched) {
        setRotation(matched.angle);
      }
    }).catch(() => {});

    const unsub = window.sanctuary.onThemeChanged((e) => {
      setActiveSectorId(e.activeThemeId);
      const matched = SECTORS.find((s) => s.id === e.activeThemeId);
      if (matched) {
        setRotation(matched.angle);
      }
    });
    return unsub;
  }, []);

  const getAngleFromCenter = useCallback((clientX: number, clientY: number): number => {
    if (!dialRef.current) return 0;
    const rect = dialRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    // atan2 gives angle where 0 is East (+X), we offset so 0 is North (-Y)
    let degrees = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (degrees < 0) degrees += 360;
    return degrees;
  }, []);

  const identifySector = useCallback((currentAngle: number): SectorInfo => {
    const normalized = ((currentAngle % 360) + 360) % 360;
    let closest = SECTORS[0];
    let minDiff = 360;
    for (const sector of SECTORS) {
      let diff = Math.abs(normalized - sector.angle);
      if (diff > 180) diff = 360 - diff;
      if (diff < minDiff) {
        minDiff = diff;
        closest = sector;
      }
    }
    return closest;
  }, []);

  // Inertial momentum animation loop
  const startMomentumLoop = useCallback(() => {
    if (animFrameId.current) cancelAnimationFrame(animFrameId.current);

    const step = () => {
      if (isInteracting.current) return;

      velocity.current *= 0.94; // damping friction
      if (Math.abs(velocity.current) > 0.08) {
        setRotation((prev) => {
          const next = prev + velocity.current;
          const currentSector = identifySector(next);
          setActiveSectorId(currentSector.id);
          return next;
        });
        animFrameId.current = requestAnimationFrame(step);
      } else {
        velocity.current = 0;
        // Snap to nearest sector and activate
        setRotation((prev) => {
          const currentSector = identifySector(prev);
          void window.sanctuary.setActiveTheme(currentSector.id);
          onThemeSwitch?.(currentSector.id);
          return prev;
        });
      }
    };
    animFrameId.current = requestAnimationFrame(step);
  }, [identifySector, onThemeSwitch]);

  const handlePointerDown = (e: React.PointerEvent) => {
    isInteracting.current = true;
    setIsDragging(true);
    if (animFrameId.current) cancelAnimationFrame(animFrameId.current);

    const currentAngle = getAngleFromCenter(e.clientX, e.clientY);
    dragStartAngle.current = currentAngle;
    dialStartRotation.current = rotation;
    lastAngle.current = currentAngle;
    velocity.current = 0;

    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    // 3D Tilt calculation
    if (dialRef.current) {
      const rect = dialRef.current.getBoundingClientRect();
      const cx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const cy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      setTilt({ x: -cy * 14, y: cx * 14 });
    }

    if (!isDragging) return;

    const currentAngle = getAngleFromCenter(e.clientX, e.clientY);
    let delta = currentAngle - lastAngle.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    velocity.current = delta * 0.8;
    lastAngle.current = currentAngle;

    setRotation((prev) => {
      const next = prev + delta;
      const currentSector = identifySector(next);
      if (currentSector.id !== activeSectorId) {
        setActiveSectorId(currentSector.id);
      }
      return next;
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    isInteracting.current = false;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    startMomentumLoop();
  };

  const handlePointerLeave = () => {
    setTilt({ x: 0, y: 0 });
    if (isDragging) {
      isInteracting.current = false;
      setIsDragging(false);
      startMomentumLoop();
    }
  };

  const activeSector = SECTORS.find((s) => s.id === activeSectorId) ?? SECTORS[0];

  return (
    <div
      ref={dialRef}
      className={`compass-astrolabe-widget ${mode} ${isDragging ? "is-dragging" : ""} ${className}`}
      style={{
        transform: `perspective(700px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      title="按住鼠标顺时针/逆时针旋转拨盘，可无极切换四大次元主题！"
    >
      {/* Outer Glow Halo */}
      <div className="astrolabe-halo" style={{ borderColor: activeSector.color }} />

      {/* Ring 1: Outer Rune & Degree Ticks (Rotates 1x) */}
      <div
        className="astrolabe-ring outer-ring"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <div className="dial-ticks" />
        {SECTORS.map((sector) => (
          <div
            key={sector.id}
            className={`cardinal-rune ${activeSectorId === sector.id ? "active" : ""}`}
            style={{
              transform: `rotate(${sector.angle}deg) translateY(-68px)`
            }}
          >
            <span>{sector.symbol}</span>
          </div>
        ))}
      </div>

      {/* Ring 2: Middle Differential Gear (Counter-rotates -0.65x) */}
      <div
        className="astrolabe-ring mid-gear"
        style={{ transform: `rotate(${-rotation * 0.65}deg)` }}
      >
        <div className="gear-teeth" />
        <div className="astrolabe-matrix-grid" />
      </div>

      {/* Ring 3: Inner Constellation / HUD Ring (Rotates 0.35x) */}
      <div
        className="astrolabe-ring inner-hud"
        style={{ transform: `rotate(${rotation * 0.35}deg)` }}
      >
        <div className="hud-brackets" />
      </div>

      {/* Top Fixed Target Alignment Arrow (12 o'clock Reference Reticle) */}
      <div className="dial-target-reticle">
        <div
          className="target-arrow-triangle"
          style={{
            borderTopColor: activeSector.color,
            filter: `drop-shadow(0 0 8px ${activeSector.color})`
          }}
        />
        <div
          className="target-beacon-dot"
          style={{ backgroundColor: activeSector.color }}
        />
      </div>

      {/* Center Astrolabe Core & Magnetic Pointer Needle */}
      <div className="astrolabe-core">
        <div
          className="core-pointer-needle"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {/* North Pointing Arrowhead */}
          <div
            className="needle-arrow-north"
            style={{
              backgroundColor: activeSector.color,
              boxShadow: `0 0 14px ${activeSector.color}`
            }}
          />
          {/* Needle Spine */}
          <div className="needle-spine" />
          {/* South Pointing Tail */}
          <div className="needle-tail-south" />
        </div>
        <div
          className="core-gemstone"
          style={{
            backgroundColor: activeSector.color,
            boxShadow: `0 0 20px ${activeSector.color}`
          }}
        >
          <span className="gemstone-symbol">✦</span>
        </div>
      </div>

      {/* Dynamic Interaction HUD Label */}
      <div className="astrolabe-label">
        <span className="label-prefix">DIAL · </span>
        <strong style={{ color: activeSector.color }}>{activeSector.name}</strong>
      </div>
    </div>
  );
}
