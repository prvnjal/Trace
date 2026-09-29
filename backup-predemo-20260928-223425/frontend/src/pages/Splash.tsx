import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { TraceMark } from '../components/TraceMark';

const TraceCanvas = lazy(() => import('../components/TraceCanvas'));

const webglAvailable = (): boolean => {
  try {
    const c = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl'))
    );
  } catch {
    return false;
  }
};

/**
 * Full-screen brand intro. Dark cinematic background (the one place the
 * brand goes dark — the app itself stays warm paper). The 3D scene fills the
 * whole viewport as a backdrop — globe above, starfield everywhere — with the
 * wordmark and enter control floating over the lower third. Static SVG mark
 * when WebGL is unavailable. Skippable at any time via button or Enter key.
 * No fake satellite-connection messaging.
 */
export const Splash: React.FC = () => {
  const navigate = useNavigate();
  const [stage, setStage] = useState(0);
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [gl] = useState(() => !reduceMotion && webglAvailable());

  const enter = useCallback(() => navigate('/overview', { replace: true }), [navigate]);

  useEffect(() => {
    if (reduceMotion) {
      setStage(4);
      return;
    }
    const timers = [
      window.setTimeout(() => setStage(1), 900), // TRACE
      window.setTimeout(() => setStage(2), 1400), // subtitle
      window.setTimeout(() => setStage(3), 1900), // enter button
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reduceMotion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') enter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enter]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0B0F0E] text-[#F2EEE3]">
      {gl ? (
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center">
              <TraceMark size={140} dark />
            </div>
          }
        >
          <TraceCanvas />
        </Suspense>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <TraceMark size={132} dark className="splash-in" />
        </div>
      )}

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-end px-6 pb-[11vh] text-center">
        <div className={`transition-opacity duration-500 ${stage >= 1 ? 'opacity-100' : 'opacity-0'}`}>
          <h1 className="font-display font-semibold text-[44px] leading-none tracking-tight">
            TRACE
          </h1>
        </div>
        <p
          className={`mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9AA39C] transition-opacity duration-500 ${stage >= 2 ? 'opacity-100' : 'opacity-0'}`}
        >
          Thermal intelligence · India
        </p>

        <div
          className={`mt-8 transition-opacity duration-500 ${stage >= 3 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <button
            type="button"
            onClick={enter}
            disabled={stage < 3}
            className="group inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/[0.05] py-2.5 pl-7 pr-2.5 text-[12px] font-semibold uppercase tracking-[0.22em] text-[#EDE9DD] backdrop-blur-sm transition-all duration-300 hover:border-white/40 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-default"
          >
            Enter platform
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EDE9DD] text-[#0B0F0E] transition-colors duration-300 group-hover:bg-white">
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </button>
          <p className="mt-3 text-[11px] text-[#8B938C]">or press Enter</p>
          <p className="mt-8 text-[11px] tracking-wide text-[#8B938C]">
            Satellite thermal intelligence for industrial safety teams
          </p>
        </div>
      </div>
    </div>
  );
};

export default Splash;
