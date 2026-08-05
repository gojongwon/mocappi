/**
 * jsdom 최소 타입 — tsconfig lib 에 DOM 이 없고(워커 코드가 document 를 보면 안 된다),
 * @types/jsdom 도 없다. 전역 lib 을 넓히는 대신 스모크 테스트가 실제로 만지는
 * 표면만 좁게 선언한다 (gui-url-state.test.ts 의 declare const 와 같은 정신).
 */
interface SmokeEl {
  textContent: string | null;
  innerHTML: string;
  className: string;
  value: string;
  href: string;
  lang: string;
  click(): void;
  style: Record<string, string>;
  dispatchEvent(e: unknown): boolean;
  querySelector(sel: string): SmokeEl | null;
  querySelectorAll(sel: string): ArrayLike<SmokeEl>;
}

interface SmokeWindow {
  document: {
    documentElement: SmokeEl;
    querySelector(sel: string): SmokeEl | null;
    querySelectorAll(sel: string): ArrayLike<SmokeEl>;
  };
  fetch: unknown;
  matchMedia: unknown;
  Event: new (type: string, init?: { bubbles?: boolean }) => Event;
}

declare module 'jsdom' {
  export class JSDOM {
    constructor(
      html: string,
      options?: {
        url?: string;
        runScripts?: 'dangerously' | 'outside-only';
        pretendToBeVisual?: boolean;
        beforeParse?(window: SmokeWindow): void;
      },
    );
    window: SmokeWindow;
  }
}
