import { useEffect, useRef, useState, useCallback } from "react";

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
  baseColor: string;
}

const SECTORS: SectorInfo[] = [
  { id: "default", name: "蔚蓝晨曦", angle: 0, symbol: "N · 晨曦", baseColor: "#0284c7" },
  { id: "builtin.hollow-zero", name: "空洞绝区", angle: 90, symbol: "E · 空洞", baseColor: "#ffd200" },
  { id: "builtin.sakura-dream", name: "樱落梦境", angle: 180, symbol: "S · 梦境", baseColor: "#ff5e97" },
  { id: "builtin.cyber-deck", name: "赛博矩阵", angle: 270, symbol: "W · 矩阵", baseColor: "#00f0ff" }
];

// Continuous dynamic chromatic spectrum interpolation
function getDynamicDialColor(deg: number): { color: string; glow: string; bgPlate: string; hue: number } {
  const norm = ((deg % 360) + 360) % 360;
  let hue = 205;
  if (norm >= 0 && norm < 90) {
    const t = norm / 90;
    hue = 205 - t * (205 - 48); // Azure (205) -> Yellow (48)
  } else if (norm >= 90 && norm < 180) {
    const t = (norm - 90) / 90;
    hue = (48 - t * 73 + 360) % 360; // Yellow (48) -> Pink (335)
  } else if (norm >= 180 && norm < 270) {
    const t = (norm - 180) / 90;
    hue = 335 - t * (335 - 185); // Pink (335) -> Cyan (185)
  } else {
    const t = (norm - 270) / 90;
    hue = 185 + t * (205 - 185); // Cyan (185) -> Azure (205)
  }
  const roundedHue = Math.round(hue);
  const color = `hsl(${roundedHue}, 96%, 58%)`;
  const glow = `hsla(${roundedHue}, 96%, 58%, 0.48)`;
  const bgPlate = `radial-gradient(circle, hsla(${roundedHue}, 80%, 45%, 0.22) 0%, rgba(12, 16, 26, 0.88) 100%)`;
  return { color, glow, bgPlate, hue: roundedHue };
}

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

  // Physics tracking state refs
  const dragStartCursorAngle = useRef<number>(0);
  const dragStartDialRotation = useRef<number>(0);
  const velocityHistory = useRef<Array<{ angle: number; time: number }>>([]);
  const velocity = useRef<number>(0);
  const animFrameId = useRef<number | null>(null);
  const isInteracting = useRef<boolean>(false);

  // Sync with current active theme on mount and events
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
    // 0 is North (-Y), clockwise
    let degrees = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (degrees < 0) degrees += 360;
    return degrees;
  }, []);

  const identifySector = useCallback((currentAngle: number): SectorInfo => {
    const normalized = ((currentAngle % 360) + 360) % 360;
    const fallback = SECTORS[0] ?? { id: "default", name: "蔚蓝晨曦", angle: 0, symbol: "N · 晨曦", baseColor: "#0284c7" };
    let closest: SectorInfo = fallback;
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

  // Smooth inertial momentum animation loop
  const startMomentumLoop = useCallback(() => {
    if (animFrameId.current) cancelAnimationFrame(animFrameId.current);

    const step = () => {
      if (isInteracting.current) return;

      velocity.current *= 0.955; // high-fidelity momentum damping
      if (Math.abs(velocity.current) > 0.04) {
        setRotation((prev) => {
          const next = prev + velocity.current;
          const currentSector = identifySector(next);
          setActiveSectorId(currentSector.id);
          return next;
        });
        animFrameId.current = requestAnimationFrame(step);
      } else {
        velocity.current = 0;
        // Snap smoothly to nearest sector and trigger theme switch
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

    const cursorAngle = getAngleFromCenter(e.clientX, e.clientY);
    dragStartCursorAngle.current = cursorAngle;
    dragStartDialRotation.current = rotation;
    velocityHistory.current = [{ angle: cursorAngle, time: performance.now() }];
    velocity.current = 0;

    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    // 3D Tilt calculation
    if (dialRef.current) {
      const rect = dialRef.current.getBoundingClientRect();
      const cx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const cy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      setTilt({ x: -cy * 12, y: cx * 12 });
    }

    if (!isDragging) return;

    const currentCursorAngle = getAngleFromCenter(e.clientX, e.clientY);
    const now = performance.now();

    // Sample rolling velocity window
    const history = velocityHistory.current;
    history.push({ angle: currentCursorAngle, time: now });
    if (history.length > 5) history.shift();

    // Shortest angular delta
    let delta = currentCursorAngle - dragStartCursorAngle.current;
    while (delta < -180) delta += 360;
    while (delta > 180) delta -= 360;

    const targetRotation = dragStartDialRotation.current + delta;
    setRotation(targetRotation);

    const currentSector = identifySector(targetRotation);
    if (currentSector.id !== activeSectorId) {
      setActiveSectorId(currentSector.id);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    isInteracting.current = false;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);

    // Calculate instantaneous release velocity from history
    const history = velocityHistory.current;
    if (history.length >= 2) {
      const oldest = history[0];
      const newest = history[history.length - 1];
      if (oldest && newest) {
        const timeSpan = Math.max(1, newest.time - oldest.time);
        let angleDiff = newest.angle - oldest.angle;
        while (angleDiff < -180) angleDiff += 360;
        while (angleDiff > 180) angleDiff -= 360;
        // Convert to degrees per frame (~16ms)
        velocity.current = (angleDiff / timeSpan) * 16;
      }
    }

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

  const fallbackSector: SectorInfo = { id: "default", name: "蔚蓝晨曦", angle: 0, symbol: "N · 晨曦", baseColor: "#0284c7" };
  const activeSector = SECTORS.find((s) => s.id === activeSectorId) ?? SECTORS[0] ?? fallbackSector;
  const dynamicColor = getDynamicDialColor(rotation);

  return (
    <div
      ref={dialRef}
      className={`compass-astrolabe-widget ${mode} ${isDragging ? "is-dragging" : ""} ${className}`}
      style={{
        transform: `perspective(700px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        background: dynamicColor.bgPlate,
        borderColor: dynamicColor.glow
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      title="按住鼠标顺时针/逆时针旋转拨盘，可无极切换四大次元主题！"
    >
      {/* Dynamic Chromatic Outer Halo */}
      <div
        className="astrolabe-halo"
        style={{
          borderColor: dynamicColor.color,
          boxShadow: `0 0 24px ${dynamicColor.glow}`
        }}
      />

      {/* Ring 1: Outer Rune & Degree Ticks (Rotates 1x) */}
      <div
        className="astrolabe-ring outer-ring"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <div className="dial-ticks" />
        {SECTORS.map((sector) => {
          const isActive = activeSectorId === sector.id;
          return (
            <div
              key={sector.id}
              className={`cardinal-rune ${isActive ? "active" : ""}`}
              style={{
                transform: `rotate(${sector.angle}deg) translateY(-54px)`,
                borderColor: isActive ? dynamicColor.color : undefined,
                boxShadow: isActive ? `0 0 12px ${dynamicColor.glow}` : undefined
              }}
            >
              <span style={{ color: isActive ? dynamicColor.color : undefined }}>
                {sector.symbol}
              </span>
            </div>
          );
        })}
      </div>

      {/* Ring 2: Middle Differential Gear (Counter-rotates -0.65x) */}
      <div
        className="astrolabe-ring mid-gear"
        style={{ transform: `rotate(${-rotation * 0.65}deg)` }}
      >
        <div className="gear-teeth" />
        <div
          className="astrolabe-matrix-grid"
          style={{ borderColor: dynamicColor.glow }}
        />
      </div>

      {/* Ring 3: Inner Constellation HUD (Rotates 0.35x) */}
      <div
        className="astrolabe-ring inner-hud"
        style={{
          transform: `rotate(${rotation * 0.35}deg)`,
          borderColor: dynamicColor.glow
        }}
      >
        <div className="hud-brackets" />
      </div>

      {/* Top Fixed Target Alignment Arrow (12 o'clock Reference Reticle) */}
      <div className="dial-target-reticle">
        <div
          className="target-arrow-triangle"
          style={{
            borderTopColor: dynamicColor.color,
            filter: `drop-shadow(0 0 10px ${dynamicColor.glow})`
          }}
        />
        <div
          className="target-beacon-dot"
          style={{
            backgroundColor: dynamicColor.color,
            boxShadow: `0 0 8px ${dynamicColor.color}`
          }}
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
              backgroundColor: dynamicColor.color,
              boxShadow: `0 0 16px ${dynamicColor.glow}`
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
            backgroundColor: dynamicColor.color,
            boxShadow: `0 0 24px ${dynamicColor.glow}`
          }}
        >
          <span className="gemstone-symbol">✦</span>
        </div>
      </div>

      {/* Dynamic Interaction HUD Label */}
      <div
        className="astrolabe-label"
        style={{ borderColor: dynamicColor.glow }}
      >
        <span className="label-prefix">DIAL · </span>
        <strong style={{ color: dynamicColor.color }}>{activeSector.name}</strong>
      </div>
    </div>
  );
}
