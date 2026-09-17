import { beforeEach, describe, expect, it } from 'vitest';
import { applyPageAction, serializePage, type ApplyOutcome } from './content';

function page(html: string) {
  document.body.innerHTML = html;
  return serializePage();
}

function indexOf(selector: string): number {
  return Number(document.querySelector(selector)?.getAttribute('data-aevra-index'));
}

function apply(action: Record<string, unknown>, index: number | null): Promise<ApplyOutcome> {
  return Promise.resolve(applyPageAction(action, index));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('serializePage', () => {
  it('captures tag, attributes, text and nesting', () => {
    const root = page('<h1 id="t">Invoices</h1><button>New invoice</button>');
    expect(root.tagName).toBe('body');
    const heading = root.children.find((child) => child.tagName === 'h1');
    expect(heading?.attributes.id).toBe('t');
    expect(heading?.textContent).toContain('Invoices');
    expect(root.children.some((child) => child.tagName === 'button')).toBe(true);
  });

  it('marks every element with a distinct index the act pass finds again', () => {
    page('<button>One</button><button>Two</button>');
    const marks = Array.from(document.querySelectorAll('[data-aevra-index]'));
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(marks.map((m) => m.getAttribute('data-aevra-index'))).size).toBe(marks.length);
  });

  it('reports the current value of form fields', () => {
    page('<input id="q" value="typed">');
    expect(serializePage().children.find((c) => c.tagName === 'input')?.value).toBe('typed');
  });

  it('captures a textarea value as well as an input', () => {
    page('<textarea id="note">drafted</textarea>');
    const field = serializePage().children.find((child) => child.tagName === 'textarea');
    expect(field?.value).toBe('drafted');
  });

  it('omits the box for an element with no layout', () => {
    // jsdom reports zero-size rects, which is exactly the has-no-box branch.
    page('<button id="b">Go</button>');
    const button = serializePage().children.find((child) => child.tagName === 'button');
    expect(button?.box).toBeUndefined();
  });

  it('records a box when the element reports one', () => {
    page('<button id="b">Go</button>');
    const target = document.querySelector('#b')!;
    target.getBoundingClientRect = () => ({ x: 1, y: 2, width: 30, height: 10 }) as DOMRect;
    const button = serializePage().children.find((child) => child.tagName === 'button');
    expect(button?.box).toEqual({ x: 1, y: 2, width: 30, height: 10 });
  });

  it('truncates very long text rather than returning unbounded content', () => {
    page(`<p>${'x'.repeat(1000)}</p>`);
    const paragraph = serializePage().children.find((child) => child.tagName === 'p');
    expect(paragraph!.textContent.length).toBeLessThanOrEqual(400);
  });
});

describe('applyPageAction: the credential wall', () => {
  it('refuses to type into a password field', async () => {
    page('<input type="password" id="p">');
    const outcome = await apply({ op: 'type', text: 'secret' }, indexOf('#p'));
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('BROWSER_CREDENTIAL_FIELD_REFUSED');
    expect((document.querySelector('#p') as HTMLInputElement).value).toBe('');
  });

  it('refuses one-time-code and payment autocomplete fields', async () => {
    for (const autocomplete of ['one-time-code', 'current-password', 'new-password', 'cc-number']) {
      page(`<input type="text" id="f" autocomplete="${autocomplete}">`);
      const outcome = await apply({ op: 'type', text: 'x' }, indexOf('#f'));
      expect(outcome.code, autocomplete).toBe('BROWSER_CREDENTIAL_FIELD_REFUSED');
      expect((document.querySelector('#f') as HTMLInputElement).value).toBe('');
    }
  });

  it('allows ordinary text fields and fires the events a page listens for', async () => {
    page('<input type="text" id="q">');
    const seen: string[] = [];
    for (const type of ['input', 'change']) {
      document.querySelector('#q')!.addEventListener(type, () => seen.push(type));
    }
    const outcome = await apply({ op: 'type', text: 'quarterly' }, indexOf('#q'));
    expect(outcome.ok).toBe(true);
    expect((document.querySelector('#q') as HTMLInputElement).value).toBe('quarterly');
    expect(seen).toEqual(['input', 'change']);
  });

  it('clear replaces rather than appends', async () => {
    page('<input type="text" id="q" value="old">');
    await apply({ op: 'type', text: 'new', clear: true }, indexOf('#q'));
    expect((document.querySelector('#q') as HTMLInputElement).value).toBe('new');
  });
});

describe('applyPageAction: other actions', () => {
  it('clicks by index', async () => {
    page('<button id="b">Go</button>');
    let clicked = 0;
    document.querySelector('#b')!.addEventListener('click', () => (clicked += 1));
    const outcome = await apply({ op: 'click' }, indexOf('#b'));
    expect(outcome.ok).toBe(true);
    expect(clicked).toBe(1);
  });

  it('reports NOT_FOUND for an index that no longer resolves', async () => {
    page('<button id="b">Go</button>');
    expect((await apply({ op: 'click' }, 9999)).code).toBe('NOT_FOUND');
  });

  it('clicks by coordinate when the action carries a point', async () => {
    page('<button id="b">Go</button>');
    let clicked = 0;
    const target = document.querySelector('#b')!;
    target.addEventListener('click', () => (clicked += 1));
    // jsdom has no layout, so elementFromPoint is absent; stub it to prove the
    // branch dispatches to whatever the page reports under the point.
    (document as any).elementFromPoint = () => target;
    const outcome = await apply({ op: 'click', x: 5, y: 5 }, null);
    expect(outcome.ok).toBe(true);
    expect(clicked).toBe(1);
    delete (document as any).elementFromPoint;
  });

  it('selects a value and fires change', async () => {
    page('<select id="s"><option value="a">A</option><option value="b">B</option></select>');
    let changed = 0;
    document.querySelector('#s')!.addEventListener('change', () => (changed += 1));
    const outcome = await apply({ op: 'select', value: 'b' }, indexOf('#s'));
    expect(outcome.ok).toBe(true);
    expect((document.querySelector('#s') as HTMLSelectElement).value).toBe('b');
    expect(changed).toBe(1);
  });

  it('dispatches keydown and keyup for press_key', async () => {
    page('<input id="q">');
    const keys: string[] = [];
    for (const type of ['keydown', 'keyup']) {
      document.body.addEventListener(type, (event) =>
        keys.push(`${type}:${(event as KeyboardEvent).key}`),
      );
    }
    const outcome = await apply({ op: 'press_key', key: 'Enter' }, null);
    expect(outcome.ok).toBe(true);
    expect(keys).toEqual(['keydown:Enter', 'keyup:Enter']);
  });

  it('scrolls the named element by the requested delta', async () => {
    page('<div id="list">rows</div>');
    const scrolled: Array<[number, number]> = [];
    (document.querySelector('#list') as any).scrollBy = (dx: number, dy: number) =>
      scrolled.push([dx, dy]);
    const outcome = await apply({ op: 'scroll', dx: 0, dy: 120 }, indexOf('#list'));
    expect(outcome.ok).toBe(true);
    expect(scrolled).toEqual([[0, 120]]);
  });

  it('treats a missing scroll delta as zero', async () => {
    page('<div id="list">rows</div>');
    const scrolled: Array<[number, number]> = [];
    (document.querySelector('#list') as any).scrollBy = (dx: number, dy: number) =>
      scrolled.push([dx, dy]);
    await apply({ op: 'scroll' }, indexOf('#list'));
    expect(scrolled).toEqual([[0, 0]]);
  });

  it('rejects an unknown action rather than silently succeeding', async () => {
    page('<button id="b">Go</button>');
    expect((await apply({ op: 'teleport' }, indexOf('#b'))).code).toBe('INVALID_REQUEST');
  });
});

describe('applyPageAction: wait_for', () => {
  it('succeeds immediately when the text is already present', async () => {
    page('<p>ran:quarterly</p>');
    const outcome = await apply({ op: 'wait_for', text: 'ran:quarterly', timeoutMs: 1000 }, null);
    expect(outcome.ok).toBe(true);
  });

  it('waits for text that appears later rather than failing on the first check', async () => {
    page('<p id="out">idle</p>');
    setTimeout(() => {
      document.querySelector('#out')!.textContent = 'ready now';
    }, 150);
    const outcome = await apply({ op: 'wait_for', text: 'ready now', timeoutMs: 2000 }, null);
    expect(outcome.ok).toBe(true);
  });

  it('succeeds immediately when no text is named at all', async () => {
    page('<p>anything</p>');
    expect((await apply({ op: 'wait_for', timeoutMs: 1000 }, null)).ok).toBe(true);
  });

  it('reports BROWSER_TIMEOUT only after its deadline', async () => {
    page('<p>idle</p>');
    const started = Date.now();
    const outcome = await apply({ op: 'wait_for', text: 'never appears', timeoutMs: 300 }, null);
    expect(outcome.code).toBe('BROWSER_TIMEOUT');
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });
});
