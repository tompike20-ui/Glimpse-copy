import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCloud } from '../cloud/useCloud';
import { pullEntries, redeemInvite } from '../cloud/sync';
import { useApp } from '../store/useApp';

/**
 * Landing point for an invite link. Redeeming needs a signed-in user, so an
 * unauthenticated visitor signs in first and lands back here — the token is in
 * the URL, so it survives the round trip.
 */
export default function Join() {
  const { token = '' } = useParams();
  const nav = useNavigate();

  const configured = useCloud((s) => s.configured);
  const userId = useCloud((s) => s.userId);
  const sendMagicLink = useCloud((s) => s.sendMagicLink);
  const reload = useApp((s) => s.init);

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !token) return;
    let cancelled = false;

    (async () => {
      try {
        setStatus('Joining…');
        const projectId = await redeemInvite(token);
        setStatus('Downloading moments…');
        await pullEntries(projectId);
        await reload();
        if (!cancelled) nav(`/p/${projectId}`, { replace: true });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, token, nav, reload]);

  if (!configured) {
    return (
      <div className="screen">
        <div className="empty">
          This build has no cloud configured, so invite links do not work.
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topbar">
        <h1>Join a Glimpse</h1>
      </div>
      <div className="pad">
        {error && <div className="banner bad">{error}</div>}

        {userId ? (
          <div className="dim">{status ?? 'Joining…'}</div>
        ) : sent ? (
          <div className="banner warn">
            Check your email for a sign-in link, then open it on this device.
          </div>
        ) : (
          <>
            <p className="dim">
              Sign in to add your own moments to this Glimpse.
            </p>
            <input
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              className="primary"
              onClick={() => {
                void sendMagicLink(email).then(() => setSent(true));
              }}
              disabled={!email.includes('@')}
            >
              Email me a link
            </button>
          </>
        )}
      </div>
    </div>
  );
}
