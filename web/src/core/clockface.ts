// The analogue clock faces in Time zones (V1.47).
//
// Where each hand points, in degrees clockwise from 12, for a moment in a zone. The faces draw every hand from
// the centre of a group moved to the middle of the face, and turn it around that group's own 0,0. Before V1.47
// they turned around "transform-origin: 20px 20px", and WebKit multiplies a px pivot on an SVG element by the
// page zoom: on a Mac with a "Larger text" display PS zooms the page to 0.8 to 0.9, the pivot moved up and left
// and the hands swung around the wrong point (a friend's Mac, Nov 2026). A 0,0 pivot is the same at any zoom.

export interface Hands { h: number; m: number; s: number }

/** The hands for a moment `ts` (ms) on a clock `offMin` minutes ahead of UTC. Hour and minute sweep smoothly,
 *  the second hand jumps once a second like a real clock. */
export function handAngles(ts: number, offMin: number): Hands {
  const wallSec = ts / 1000 + offMin * 60;              // seconds on that zone's wall clock
  const mod = (x: number, n: number) => ((x % n) + n) % n;
  return {
    h: mod(wallSec / 120, 360),                         // 360 degrees in 12 hours = 43,200 s
    m: mod(wallSec / 10, 360),                          // 360 degrees in an hour = 3,600 s
    s: mod(Math.floor(wallSec), 60) * 6,
  };
}

/** The SVG face's size in its own units (viewBox 0 0 40 40) and its centre, where every hand turns. */
export const FACE = { size: 40, c: 20 };
