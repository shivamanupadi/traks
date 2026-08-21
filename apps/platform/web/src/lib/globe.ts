import type { Globe, Marker } from 'cobe';

/** A city with active visitors; `weight` drives marker size and focus. */
export interface GlobePoint {
  latitude: number;
  longitude: number;
  weight: number;
}

export interface GlobeTheme {
  /** 0-1 RGB. */
  land: [number, number, number];
  marker: [number, number, number];
  glow: [number, number, number];
}

const TAU = Math.PI * 2;
/** Radians per frame while nothing else is moving the globe. */
const IDLE_SPIN = 0.0012;
/** Fraction of the remaining angle covered per frame while easing to a focus. */
const FOCUS_EASE = 0.05;
const FOCUS_DONE = 0.004;
/** Per-frame decay of fling velocity after a drag ends. */
const FLING_DECAY = 0.93;
const FLING_STOP = 0.0005;
/** Pixels of horizontal drag per radian. */
const DRAG_PX_PER_RAD = 150;

/** Signed shortest rotation from `from` to `to`, in (-π, π]. */
function shortestArc(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/**
 * The phi at which longitude λ faces the camera. cobe's location→vector
 * mapping offsets longitude by π before the phi rotation, so the meridian
 * facing the viewer is phi ≡ π - λ (checked visually: phi = -λ shows the
 * antipode). Normalized to [0, 2π).
 */
function phiFacing(longitudeDeg: number): number {
  const lambda = (longitudeDeg * Math.PI) / 180;
  return (((Math.PI - lambda) % TAU) + TAU) % TAU;
}

function markerSize(weight: number): number {
  // Log scale: one busy city grows visibly without swallowing the globe.
  return 0.03 + Math.min(0.075, Math.log2(weight + 1) * 0.015);
}

/**
 * Owns a cobe globe on a canvas, independent of React: sizing, the animation
 * loop, idle spin, drag with fling, and easing toward the busiest city when
 * the leader changes. The loop pauses while the document is hidden and idle
 * spin is off under prefers-reduced-motion (explicit drags still work).
 */
export class GlobeController {
  private globe: Globe | null = null;
  private frame = 0;
  private disposed = false;
  private observer: ResizeObserver | null = null;

  private phi = 0.9;
  private velocity = 0;
  private focusPhi: number | null = null;
  private leaderKey: string | null = null;
  private dragging = false;
  private lastDragDelta = 0;

  private markers: Marker[] = [];
  private px = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
    private readonly theme: GlobeTheme,
    private readonly reducedMotion: boolean
  ) {}

  /** Loads cobe (lazily, off the main chunk) and starts rendering. */
  async start(): Promise<void> {
    const { default: createGlobe } = await import('cobe');
    if (this.disposed) return;

    this.px = this.measure();
    this.globe = createGlobe(this.canvas, {
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      width: this.px,
      height: this.px,
      phi: this.phi,
      theta: 0.2,
      dark: 0,
      diffuse: 1.15,
      scale: 1,
      mapSamples: 15000,
      mapBrightness: 4.2,
      mapBaseBrightness: 0,
      baseColor: this.theme.land,
      markerColor: this.theme.marker,
      glowColor: this.theme.glow,
      markerElevation: 0.02,
      markers: this.markers,
    });

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule();
  }

  /** Replace the plotted cities; a new busiest city turns the globe toward it. */
  setPoints(points: GlobePoint[]): void {
    this.markers = points.map(p => ({
      location: [p.latitude, p.longitude],
      size: markerSize(p.weight),
    }));
    this.globe?.update({ markers: this.markers });

    const leader = points.reduce<GlobePoint | null>(
      (best, p) => (best === null || p.weight > best.weight ? p : best),
      null
    );
    const key = leader ? `${leader.latitude},${leader.longitude}` : null;
    if (key !== this.leaderKey) {
      this.leaderKey = key;
      if (leader && !this.dragging) this.focusPhi = phiFacing(leader.longitude);
    }
  }

  /** Pointer down: stop any motion and follow the pointer. */
  grab(): void {
    this.dragging = true;
    this.velocity = 0;
    this.focusPhi = null;
    this.lastDragDelta = 0;
  }

  /** Pointer moved `dx` pixels while grabbed. */
  drag(dx: number): void {
    if (!this.dragging) return;
    const delta = dx / DRAG_PX_PER_RAD;
    this.phi += delta;
    this.lastDragDelta = delta;
  }

  /** Pointer up: carry the last drag delta as fling velocity. */
  release(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.velocity = this.lastDragDelta;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.globe?.destroy();
    this.globe = null;
  }

  private measure(): number {
    return Math.max(1, Math.round(this.host.getBoundingClientRect().width));
  }

  private resize(): void {
    const px = this.measure();
    if (px === this.px) return;
    this.px = px;
    this.globe?.update({ width: px, height: px });
  }

  private readonly onVisibility = (): void => {
    // Rendering resumes from wherever it stopped; no catch-up spin.
    if (document.visibilityState === 'visible') this.schedule();
    else cancelAnimationFrame(this.frame);
  };

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    if (this.disposed || !this.globe) return;

    if (!this.dragging) {
      if (Math.abs(this.velocity) > FLING_STOP) {
        this.phi += this.velocity;
        this.velocity *= FLING_DECAY;
      } else if (this.focusPhi !== null) {
        const remaining = shortestArc(this.phi, this.focusPhi);
        if (Math.abs(remaining) < FOCUS_DONE) {
          this.phi = this.focusPhi;
          this.focusPhi = null;
        } else {
          this.phi += remaining * FOCUS_EASE;
        }
      } else if (!this.reducedMotion) {
        this.phi += IDLE_SPIN;
      }
    }

    this.globe.update({ phi: this.phi });
    this.frame = requestAnimationFrame(this.tick);
  };
}
