import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './store/useApp';
import { useCloud } from './cloud/useCloud';
import ProjectList from './routes/ProjectList';
import Capture from './routes/Capture';
import Editor from './routes/Editor';
import Join from './routes/Join';
import { Onboarding } from './ui/Onboarding';

export default function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const cloudInit = useCloud((s) => s.init);

  // Shown once, then never again. localStorage rather than the journal: it is
  // a device preference, not part of any Glimpse's history.
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem('glimpse.onboarded') === '1',
  );

  useEffect(() => {
    void init();
    void cloudInit();
  }, [init, cloudInit]);

  if (!ready) {
    return (
      <div className="screen">
        <div className="empty">Loading your Glimpses…</div>
      </div>
    );
  }

  if (!onboarded) {
    return (
      <Onboarding
        onDone={() => {
          localStorage.setItem('glimpse.onboarded', '1');
          setOnboarded(true);
        }}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<ProjectList />} />
      <Route path="/p/:id" element={<Editor />} />
      <Route path="/p/:id/capture" element={<Capture />} />
      <Route path="/join/:token" element={<Join />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
