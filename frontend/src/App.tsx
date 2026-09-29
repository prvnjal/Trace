import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TraceDataProvider } from './data/TraceDataContext';
import { AppShell } from './components/AppShell';
import Overview from './pages/Overview';
import LiveMap from './pages/LiveMap';
import Events from './pages/Events';
import EventDetail from './pages/EventDetail';
import Facilities from './pages/Facilities';
import FacilityDetail from './pages/FacilityDetail';
import Analytics from './pages/Analytics';
import Alerts from './pages/Alerts';
import About from './pages/About';

const Splash = lazy(() => import('./pages/Splash'));

const SplashFallback: React.FC = () => (
  <div className="min-h-screen bg-paper flex items-center justify-center">
    <span className="font-display font-semibold text-[28px] tracking-tight text-ink">
      TRACE
    </span>
  </div>
);

export const App: React.FC = () => (
  <HashRouter>
    <TraceDataProvider>
      <Suspense fallback={<SplashFallback />}>
        <Routes>
          <Route path="/" element={<Splash />} />
          <Route element={<AppShell />}>
            <Route path="/overview" element={<Overview />} />
            <Route path="/map" element={<LiveMap />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/:code" element={<EventDetail />} />
            <Route path="/facilities" element={<Facilities />} />
            <Route path="/facilities/:id" element={<FacilityDetail />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </TraceDataProvider>
  </HashRouter>
);

export default App;
