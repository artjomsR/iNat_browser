# iPhone link handoff checks

Only the index/map page loads navigation.js. It records link attempts and lifecycle
events without changing link targets or cancelling default activation. No history
entries, redirects, retries or fallback timers are added. The map's existing opening
mechanism is unchanged; universal-link routing still belongs to iOS/iNaturalist.

Run automated checks: `node --test --test-isolation=none tests/navigation.test.cjs`.

On a real iPhone, check map observation rows and pins. Repeat in Safari and from
the home screen, with iNat already running and after closing it. Check returning to the
browser, switching apps several times, and using iNat normally afterwards.
Also verify a link that iNat does not claim and return navigation.
Record whether delay precedes iNat appearing or only the observation loading.

After an unexpected opening, use Safari's remote inspector on the affected web
app to copy `JSON.stringify(__navlog(), null, 2)`. `__clearNavlog()` erases it.
The last 80 events are stored locally under `inat.navigation.v1`, retained across
map loads within the same origin/storage context. Species and gallery do not log events. Nothing is uploaded.
Queries and hashes are excluded; destinations retain observation IDs, otherwise
only origin and the first path segment. Each document load has a session ID.

`link` records anchor activation (including synthetic pin clicks, trusted=false);
`openOut` records a scripted new-window request in browser mode. These indicate
attempts, not successful native delivery. `pageshow`, `pagehide`, visibility and
`popstate` provide return/history context. A back_forward navigation type refers
to document loading; persisted and popstate help interpret cached/history returns.
Absence of an event does not prove iNat is responsible: storage may be blocked,
events may have aged out, and Safari/home-screen contexts may have separate logs.

An old observation opening with no corresponding website activation is evidence
to investigate iNat's handling, not proof of a particular native-app bug.
