// A tiny DOM helper instead of a UI framework (the Samsung app's, plus tap handling).

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  attrs?: { [name: string]: string };
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) for (const name of Object.keys(props.attrs)) el.setAttribute(name, props.attrs[name]);
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

export function clear(el: Node): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function toggle(el: Element, className: string, on: boolean): void {
  if (el.classList.contains(className) !== on) el.classList.toggle(className, on);
}

// A tap (click) handler; returns the element for chaining.
export function onTap<T extends HTMLElement>(el: T, handler: (event: MouseEvent) => void): T {
  el.addEventListener("click", handler);
  return el;
}

// A button with an icon (inline SVG) and an optional label.
export function iconButton(className: string, icon: string, label: string, showLabel = false): HTMLButtonElement {
  const button = h("button", { class: className, attrs: { type: "button", "aria-label": label } });
  button.innerHTML = icon;
  if (showLabel) button.appendChild(h("span", { text: label }));
  return button;
}

// Holding a finger (or the mouse) down for `ms` calls `onHold`; the click that follows is
// then swallowed, so a long press doesn't also open the poster.
export function onHold(el: HTMLElement, ms: number, onHold: () => void): void {
  let timer = 0;
  let held = false;
  let startX = 0;
  let startY = 0;
  const cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  el.addEventListener("pointerdown", (event) => {
    held = false;
    startX = event.clientX;
    startY = event.clientY;
    cancel();
    timer = window.setTimeout(() => {
      timer = 0;
      held = true;
      onHold();
    }, ms);
  });
  el.addEventListener("pointermove", (event) => {
    if (timer && (Math.abs(event.clientX - startX) > 10 || Math.abs(event.clientY - startY) > 10)) cancel();
  });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("contextmenu", (event) => event.preventDefault());
  el.addEventListener(
    "click",
    (event) => {
      if (!held) return;
      held = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
