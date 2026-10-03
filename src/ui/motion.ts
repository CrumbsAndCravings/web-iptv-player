// Motion, as on Netflix: a poster grows into the title's page (and back), pictures fade
// in once they've loaded, and lists build in one after another. Safari's View
// Transitions (iOS 18 on) do the growing; without them, or with Reduce Motion on, pages
// simply slide. Nothing here waits for an animation to finish before doing its work.

// The iPhone's Reduce Motion setting.
export function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

type StartViewTransition = (update: () => void) => { finished: Promise<void> };

// One element turning into another as the page changes: `from` (on the page now) and
// `to` (on the page `update` makes) share a name while Safari animates between them.
// Returns false, doing nothing, where it can't, so the caller changes the page itself.
export function morph(from: HTMLElement | null, to: HTMLElement | null, update: () => void): boolean {
  const start = (document as unknown as { startViewTransition?: StartViewTransition }).startViewTransition;
  if (!from || !to || !from.isConnected || typeof start !== "function" || reducedMotion()) return false;
  const name = "aranplus-morph";
  from.style.setProperty("view-transition-name", name);
  document.documentElement.classList.add("is-morphing");
  let transition: { finished: Promise<void> };
  try {
    transition = start.call(document, () => {
      from.style.removeProperty("view-transition-name");
      to.style.setProperty("view-transition-name", name);
      update();
    });
  } catch {
    from.style.removeProperty("view-transition-name");
    document.documentElement.classList.remove("is-morphing");
    return false;
  }
  const done = () => {
    to.style.removeProperty("view-transition-name");
    document.documentElement.classList.remove("is-morphing");
  };
  transition.finished.then(done, done);
  return true;
}

// The poster (or picture) tapped a moment ago, for the page it opens to grow out of.
let tapped: { el: HTMLElement; at: number } | null = null;

export function noteTapped(el: HTMLElement): void {
  tapped = { el, at: Date.now() };
}

export function takeTapped(): HTMLElement | null {
  const last = tapped;
  tapped = null;
  return last && Date.now() - last.at < 1500 && last.el.isConnected ? last.el : null;
}

// A background picture that fades in once it has loaded, instead of appearing in
// strips. `el` gets "is-loaded" then (the CSS fades it); straight away if it's cached.
export function fadeInBackground(el: HTMLElement, url: string): void {
  if (!url) return;
  const css = 'url("' + url.replace(/"/g, "%22") + '")';
  const loader = new Image();
  const show = () => {
    el.style.backgroundImage = css;
    el.classList.add("is-loaded");
  };
  loader.onload = show;
  loader.onerror = () => undefined;
  loader.src = url;
  if (loader.complete && loader.naturalWidth > 0) show();
}

// Lists build in one after another: each of the first `max` children gets its place in
// line (--i), which the CSS turns into a delay.
export function stagger(children: Iterable<Element>, max = 10): void {
  let i = 0;
  for (const child of children) {
    if (i >= max) break;
    (child as HTMLElement).style.setProperty("--i", String(i++));
  }
}
