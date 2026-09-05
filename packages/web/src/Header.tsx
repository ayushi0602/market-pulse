type Tab = 'watchlist' | 'attention' | 'replay';

/**
 * Site chrome: the part of a Groww-style screen this app never had.
 *
 * Reskinning the dashboard's colours and cards was not enough to read as "a
 * site" -- a real product has a persistent bar naming what it is, how to move
 * between its sections, and who is looking at it. This is that bar: a
 * wordmark on the left where a logo sits, the three tabs promoted out of the
 * page body and into permanent nav, and an account chip on the right.
 *
 * Deliberately not a new source of truth. `tab` and `user` still live in
 * `App`, exactly as before -- this component only relocates where they are
 * rendered and clicked.
 */
export function Header({
  tab,
  onTabChange,
  user,
  onUserChange,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  user: string;
  onUserChange: (user: string) => void;
}) {
  const initial = (user.trim() || '?').charAt(0).toUpperCase();

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Market Pulse</span>
        </div>

        <nav className="tabs" role="tablist" aria-label="Screens">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'watchlist'}
            onClick={() => onTabChange('watchlist')}
          >
            My watchlist
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'attention'}
            onClick={() => onTabChange('attention')}
          >
            While you were away
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'replay'}
            onClick={() => onTabChange('replay')}
          >
            Replay
          </button>
        </nav>

        <label className="account-chip">
          <span className="account-avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="account-text">
            <span className="account-label">Viewing as</span>
            <input
              type="text"
              value={user}
              onChange={(e) => onUserChange(e.target.value.trim() || 'demo')}
              aria-label="User id"
            />
          </span>
        </label>
      </div>
    </header>
  );
}
