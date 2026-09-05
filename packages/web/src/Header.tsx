type Tab = 'watchlist' | 'attention' | 'replay';

/**
 * The tabs, in order, as data.
 *
 * The order is the thing arrow-key navigation moves through, so it needs to
 * exist as a value rather than only as the sequence three JSX blocks happen to
 * appear in.
 */
const TABS: readonly { readonly key: Tab; readonly label: string }[] = [
  { key: 'watchlist', label: 'My watchlist' },
  { key: 'attention', label: 'While you were away' },
  { key: 'replay', label: 'Replay' },
];

/** Ids shared with the panel in `App`, so the two halves of the pattern connect. */
export const tabId = (tab: Tab): string => `tab-${tab}`;
export const panelId = (tab: Tab): string => `panel-${tab}`;

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

  /**
   * Arrow keys move between tabs; Home and End jump to the ends.
   *
   * Selection follows focus, which is the right choice here: switching screens
   * is cheap and reversible, and it is what makes the pattern feel like tabs
   * rather than a menu.
   */
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    /*
     * Relative to the tab that has focus, not the one that is selected.
     *
     * They are normally the same -- the roving tabindex means only the selected
     * tab is reachable, and selection follows focus -- but reading the selected
     * one made the two coupled by assumption rather than by construction, and
     * they came apart the moment focus was moved any other way. The event
     * target is the authority on where the user actually is.
     */
    const focused = (event.target as HTMLElement | null)?.closest('[role="tab"]')?.id;
    const fromFocus = TABS.findIndex((entry) => tabId(entry.key) === focused);
    const current = fromFocus === -1 ? TABS.findIndex((entry) => entry.key === tab) : fromFocus;
    if (current === -1) return;

    const next = (() => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          return (current + 1) % TABS.length;
        case 'ArrowLeft':
        case 'ArrowUp':
          return (current - 1 + TABS.length) % TABS.length;
        case 'Home':
          return 0;
        case 'End':
          return TABS.length - 1;
        default:
          return undefined;
      }
    })();

    if (next === undefined) return;
    event.preventDefault();

    const target = TABS[next];
    if (target === undefined) return;
    onTabChange(target.key);
    // Focus follows selection, so the roving tabindex stays where the user is.
    document.getElementById(tabId(target.key))?.focus();
  };

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Market Pulse</span>
        </div>

        {/*
          A complete ARIA tabs pattern, rather than half of one.

          This had role="tablist" and role="tab" with aria-selected, and then
          none of what those roles promise: no tabpanel to point at, no
          aria-controls, and no arrow-key navigation. Announcing "tab, 1 of 3,
          selected" and then having Tab move to the next tab instead of into
          the content is worse than plain buttons would have been, because the
          roles set an expectation the markup did not keep.
        */}
        <nav className="tabs" role="tablist" aria-label="Screens" onKeyDown={onTabKeyDown}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={tabId(key)}
              aria-controls={panelId(key)}
              aria-selected={tab === key}
              // Roving tabindex: the tablist is one stop, and arrows move
              // within it. Without this, reaching the page content means
              // tabbing past every screen name.
              tabIndex={tab === key ? 0 : -1}
              onClick={() => onTabChange(key)}
            >
              {label}
            </button>
          ))}
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
