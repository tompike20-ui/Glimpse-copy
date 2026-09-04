import { Icon } from './Icon';

/**
 * First-run introduction. Three points, one action, then out of the way for
 * good — an app that explains itself once reads as finished, and the concept
 * here (a video you keep adding to) is not self-evident from an empty list.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  return (
    <div className="onboard">
      <div className="onboard-mark">
        <Icon name="film" size={42} strokeWidth={1.6} />
      </div>

      <h1>Moments, not takes.</h1>
      <p className="lede">
        Capture a second at a time. Every moment joins the same growing video.
      </p>

      <div className="onboard-points">
        <div className="onboard-point">
          <span className="ico">
            <Icon name="camera" />
          </span>
          <div>
            <h2>Shoot in seconds</h2>
            <p>
              Tap once for a one-second moment. Keep it or shoot again — the
              camera stays ready.
            </p>
          </div>
        </div>

        <div className="onboard-point">
          <span className="ico">
            <Icon name="sparkle" />
          </span>
          <div>
            <h2>Nothing gets lost</h2>
            <p>
              Every moment is saved the instant it is recorded, with a live mic
              meter so you never film in silence by accident.
            </p>
          </div>
        </div>

        <div className="onboard-point">
          <span className="ico">
            <Icon name="share" />
          </span>
          <div>
            <h2>Yours, on your phone</h2>
            <p>
              Everything stays on this device. Export to Photos whenever you
              like — no account, no upload.
            </p>
          </div>
        </div>
      </div>

      <button className="btn filled" onClick={onDone}>
        Get Started
      </button>
    </div>
  );
}
