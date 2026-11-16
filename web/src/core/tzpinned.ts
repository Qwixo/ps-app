// Time zones, kept open (V1.65). The developer's friend, 17 Nov 2026: "when you click pin on the time zones ... I don't want that
// weird animation where you swipe to a different page and then the time zones expand in front of you. It should already be
// expanded." The loop-out animation is for when YOU open the panel. A panel kept open that arrives with its page (a swipe, a
// page change, the editor closing) is drawn open from its first frame, with nothing to animate. Not kept open: as before.

/** Does the panel draw already open, without the loop out? Only when it is kept open and nobody just opened it. */
export function panelMountsStill(pinned: boolean, youJustOpenedIt: boolean): boolean {
  return pinned && !youJustOpenedIt;
}
