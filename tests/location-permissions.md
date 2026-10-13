# Current-location permission flow

## Investigation

All geolocation calls and the sole orientation-permission call are in the locate section
of index.js. There is one custom locate button; Leaflet does not request location here.
There are no app-created location permission dialogs, DeviceMotionEvent requests, iframes,
component remounts or saved permission grants. The persisted hash is map UI state only.

The previous implementation already shared one watch, but cached coordinates indefinitely,
did not pause/resume the watch on visibility changes, and tried orientation permission on
startup without a user gesture. A fresh unpinned launch also requested GPS unconditionally.
These are lifecycle problems; they do not establish why a particular iPhone repeated its
native permission prompt.

The Pages workflow serves static files. Internal links and scripts use relative paths;
no source-level redirect switches origins. The actual installed URL and live deployment
redirect chain could not be checked in this environment. The Unfog repository could not
be fetched; implementation follows the reference behavior supplied in the task.

## Behavior

The map dot, boot centring and button share one watch (high accuracy, maximumAge 0,
timeout 30 seconds). A tap reuses a fix younger than 30 seconds or a deduplicated one-shot
(high accuracy, maximumAge 30 seconds, timeout 15 seconds). Position timestamps determine
freshness; expired dots disappear. No location or permission is written to storage.

Hidden/pagehide clears the watch and dot; visible/pageshow resumes only if location is
still wanted. Generation checks ignore late callbacks. Denial/revocation disables automatic
restart; an explicit tap can retry. Timeout/unavailable errors show non-modal feedback.

Boot requests location only for an unpinned view and a browser-reported existing grant.
Unsupported or rejected permission queries leave location to a tap. The query cannot grant
permission. Shared/saved views do not start tracking automatically.

Compass permission is invoked synchronously from the button gesture, independently of GPS.
Pending requests are shared, denial is remembered only for this page lifetime, and sensor
failures cannot prevent location. No startup compass prompt is attempted.

## Validation

Run `node --test --test-isolation=none tests/location.test.cjs` and `node --check index.js`.
The dependency-free tests run the actual locate section with mocked browser/GPS/sensor
APIs. They cover rapid taps, freshness, background/foreground and page restoration, late
callbacks, denial/retry, revocation to prompt, unavailable/timeout errors, sensor denial
and exceptions, unsupported/rejected permission queries, and startup/tap races.

Physical iPhone testing has NOT been performed. On the deployed HTTPS origin, check:

1. First Home Screen launch, then tap: location and motion can prompt independently.
2. Allow GPS and deny motion: map centres; rapid/repeated taps work without app dialogs.
3. Background and return: dot refreshes; old coordinates are not displayed as live.
4. Close/reopen the installed app: confirm whether that iOS version retains location approval.
5. Revoke location in settings, then return: no automatic retry loop; explicit retry gives feedback.
6. Deny location, allow it later, test indoors/timeouts, and retry from the button.
7. Record the installed URL and final URL after launch; verify the same HTTPS origin and
   top-level browsing context, including navigation back from the species page.

Native permission persistence and expiry remain controlled by iOS. This code cannot
permanently suppress prompts or transfer approval across origins or browsing contexts.
