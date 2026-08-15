import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './store/useApp';
import { useCloud } from './cloud/useCloud';
import ProjectList from './routes/ProjectList';
import Capture from './routes/Capture';
import Editor from './routes/Editor';
import Join from './routes/Join';

export default function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const cloudInit = useCloud((s) => s.init);

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
