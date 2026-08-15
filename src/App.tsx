import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './store/useApp';
import ProjectList from './routes/ProjectList';
import Capture from './routes/Capture';
import Editor from './routes/Editor';

export default function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);

  useEffect(() => {
    void init();
  }, [init]);

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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
