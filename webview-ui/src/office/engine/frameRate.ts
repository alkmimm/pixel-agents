/**
 * pixel-agents-secure (local): whether the render loop skips this animation
 * frame to stay at or under the wanted rate (gameLoop.ts). Pure, so it is
 * tested without a browser.
 */
export function skipFrame(time: number, lastTime: number, fps: number | undefined): boolean {
  if (fps === undefined || fps <= 0 || lastTime === 0) return false;
  // 2 ms of slack: animation frames do not land exactly on the interval.
  return time - lastTime < 1000 / fps - 2;
}
