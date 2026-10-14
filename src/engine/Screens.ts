import * as THREE from 'three';
import type { StadiumParts } from './StadiumView';

export type ScreenContent =
  | { mode: 'welcome'; brand: string; venue: string }
  | { mode: 'score'; home: string; away: string; hs: number; as: number; minute: string; homeColor: string; awayColor: string }
  | { mode: 'message'; title: string; sub?: string; accent?: string }
  | { mode: 'off' };

/** Écrans géants : surface d'interface intégrée au stade. Redessinés uniquement quand le contenu change. */
export class ScreenLayer {
  group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshBasicMaterial;
  private disposables: Array<{ dispose(): void }> = [];
  private last = '';

  constructor(parts: StadiumParts, private accent: string) {
    this.canvas.width = 1024; this.canvas.height = 430;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#15181e', roughness: 0.6, metalness: 0.4 });
    this.disposables.push(this.tex, this.mat, frameMat);
    for (const s of parts.screens) {
      const g = new THREE.Group();
      const geo = new THREE.PlaneGeometry(s.w, s.h);
      const frame = new THREE.BoxGeometry(s.w + 0.8, s.h + 0.8, 0.6);
      this.disposables.push(geo, frame);
      const face = new THREE.Mesh(geo, this.mat);
      face.position.z = 0.31;
      g.add(new THREE.Mesh(frame, frameMat), face);
      g.position.copy(s.pos);
      g.lookAt(s.look);
      this.group.add(g);
    }
  }

  show(c: ScreenContent) {
    const key = JSON.stringify(c);
    if (key === this.last) return;
    this.last = key;
    const x = this.canvas.getContext('2d')!;
    const W = 1024, H = 430;
    const bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b0f16'); bg.addColorStop(1, '#05070b');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const font = (w: number, s: number) => `${w} ${s}px Inter, system-ui, sans-serif`;
    if (c.mode === 'off') { x.fillStyle = '#000'; x.fillRect(0, 0, W, H); }
    else if (c.mode === 'welcome') {
      x.fillStyle = '#9aa6b4'; x.font = font(600, 40); x.fillText('BIENVENUE AU', W / 2, 120);
      x.fillStyle = '#ffffff'; x.font = font(800, 86); x.fillText(c.venue.toUpperCase(), W / 2, 215, W - 80);
      x.fillStyle = this.accent; x.font = font(800, 38); x.fillText(c.brand.toUpperCase(), W / 2, 320);
    } else if (c.mode === 'score') {
      x.fillStyle = c.homeColor; x.fillRect(60, 110, 16, 140);
      x.fillStyle = c.awayColor; x.fillRect(W - 76, 110, 16, 140);
      x.fillStyle = '#fff'; x.font = font(800, 64);
      x.fillText(c.home, 250, 180); x.fillText(c.away, W - 250, 180);
      x.font = font(800, 130); x.fillText(`${c.hs}–${c.as}`, W / 2, 185);
      x.fillStyle = this.accent; x.font = font(700, 42); x.fillText(c.minute, W / 2, 330);
    } else {
      x.fillStyle = c.accent ?? this.accent; x.font = font(800, 92); x.fillText(c.title, W / 2, c.sub ? 170 : 215, W - 60);
      if (c.sub) { x.fillStyle = '#e8edf3'; x.font = font(600, 48); x.fillText(c.sub, W / 2, 290, W - 60); }
    }
    this.tex.needsUpdate = true;
  }

  dispose() { this.disposables.forEach((d) => d.dispose()); }
}
