import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Full-bleed splash scene: a dark graphite wireframe globe (graticule)
 * rotating slowly over a starfield that fills the frame. Pure monochrome.
 * The globe sits slightly above center so overlay text has clean space below.
 * Abstract and restrained. No glow, no neon, no color accents.
 * Slow stately motion.
 */
export const TraceCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return; // parent falls back to the static SVG mark
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 7.0);
    camera.lookAt(0, 0, 0);

    // Restrained studio lighting with a cool rim for edge definition.
    scene.add(new THREE.HemisphereLight(0xf5efe2, 0x0b0f0e, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(4, 6, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd2c4, 2.0);
    rim.position.set(-6, -1, -5);
    scene.add(rim);
    const under = new THREE.DirectionalLight(0x2a3a33, 0.5);
    under.position.set(0, -6, 2);
    scene.add(under);

    const group = new THREE.Group();
    // Lift the composition so overlay text sits in clean starfield below.
    group.position.y = 0.9;
    scene.add(group);

    const fadeMats: THREE.Material[] = [];
    const track = <T extends THREE.Material>(m: T): T => {
      m.transparent = true;
      m.opacity = 0;
      fadeMats.push(m);
      return m;
    };

    // ---- Globe: dark graphite sphere + graticule wireframe ----
    const R = 1.15;
    const globe = new THREE.Group();
    group.add(globe);

    const sphereMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x232b28,
        metalness: 0.35,
        roughness: 0.65,
      })
    );
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), sphereMat));

    const gratMat = track(
      new THREE.LineBasicMaterial({ color: 0x8a9a90, transparent: true })
    );
    const gratTarget = 0.75;
    // Longitudes
    for (let i = 0; i < 12; i++) {
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= 72; j++) {
        const a = (j / 72) * Math.PI * 2;
        pts.push(new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), 0));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        gratMat
      );
      line.rotation.y = (i / 12) * Math.PI;
      globe.add(line);
    }
    // Latitudes
    for (let k = -2; k <= 2; k++) {
      if (k === 0) continue;
      const lat = (k / 3) * (Math.PI / 2) * 0.92;
      const rr = R * Math.cos(lat);
      const y = R * Math.sin(lat);
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= 72; j++) {
        const a = (j / 72) * Math.PI * 2;
        pts.push(new THREE.Vector3(rr * Math.cos(a), y, rr * Math.sin(a)));
      }
      globe.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat)
      );
    }
    // Equator, slightly brighter
    {
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= 72; j++) {
        const a = (j / 72) * Math.PI * 2;
        pts.push(new THREE.Vector3(R * Math.cos(a), 0, R * Math.sin(a)));
      }
      const eqMat = track(
        new THREE.LineBasicMaterial({ color: 0x7a8a7e, transparent: true })
      );
      globe.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), eqMat)
      );
      (eqMat as THREE.LineBasicMaterial).opacity = 0; // animated with the rest
      fadeMats.push(eqMat);
    }

    // ---- Slow-drifting starfield, sized to fill the frame ----
    // All stars sit well behind the scene: none can drift near the camera
    // and render as an oversized square.
    const STAR_N = 450;
    const starPos = new Float32Array(STAR_N * 3);
    for (let i = 0; i < STAR_N; i++) {
      const r = 12 + Math.random() * 12;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      starPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      starPos[i * 3 + 2] = -(4 + Math.random() * 18);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = track(
      new THREE.PointsMaterial({ color: 0x9aa3ad, size: 2.5, sizeAttenuation: false })
    );
    const starTarget = 0.7;
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    const reduceMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const w = wrap.clientWidth || window.innerWidth;
      const h = wrap.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();
    let raf = 0;

    const renderFrame = (t: number) => {
      const fade = Math.min(1, t / 1.2);
      for (const m of fadeMats) {
        m.opacity = fade * (m === gratMat ? gratTarget : m === starMat ? starTarget : 1);
      }
      // Fit the whole composition inside narrow viewports.
      const fit = Math.min(1, camera.aspect * 1.222);
      const s = (0.88 + 0.12 * Math.min(1, t / 1.4)) * fit;
      group.scale.setScalar(s);

      // Globe: slow stately rotation.
      globe.rotation.y = t * 0.12;

      // Background life: starfield drifts almost imperceptibly.
      stars.rotation.y = t * 0.008;

      renderer.render(scene, camera);
    };

    if (reduceMotion) {
      renderFrame(10); // single composed frame, no loop
    } else {
      const loop = () => {
        renderFrame(clock.getElapsedTime());
        raf = requestAnimationFrame(loop);
      };
      loop();
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      scene.traverse((obj) => {
        const anyObj = obj as THREE.Mesh | THREE.Line;
        if (anyObj.geometry) anyObj.geometry.dispose();
        const mat = (anyObj as THREE.Mesh).material as THREE.Material | undefined;
        if (mat) mat.dispose();
      });
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0" aria-hidden="true">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
};

export default TraceCanvas;
