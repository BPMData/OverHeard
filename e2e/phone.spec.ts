import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Phone-sized checks for every main view. Each view must fit the screen width (no sideways
// scrolling). With PHONE_SHOTS=1 the spec also saves a screenshot of each view and logs
// the controls that are too small to tap or stick out past the screen, for PR review.
const SHOTS = process.env.PHONE_SHOTS === '1';
const SHOT_DIR = 'phone-screenshots';

const sizes = [
  { name: 'phone-360', width: 360, height: 780 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
];

async function mockTranslation(page: Page) {
  await page.route('**/api/mt', async (route) => {
    const { text, lang } = route.request().postDataJSON();
    await route.fulfill({ json: { translation: `[${lang}] ${text}`, provider: 'gtx', ms: 1 } });
  });
}

/** Measures what a phone user would trip over; returns the page's sideways overflow in px. */
async function check(page: Page, size: string, view: string) {
  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const label = (el: Element) =>
      (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('placeholder') || el.tagName)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40);
    const controls = [...document.querySelectorAll('button, a[href], input, select, summary, textarea')].filter(
      (el) => visible(el) && !(el as HTMLInputElement).disabled
    );
    const small = controls
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => {
        const type = (el as HTMLInputElement).type;
        if (type === 'checkbox' || type === 'radio') return false;
        return r.height < 36 || r.width < 36;
      })
      .map(({ el, r }) => `${label(el)} (${Math.round(r.width)}x${Math.round(r.height)})`);
    const offscreen = controls
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > vw + 1 || r.left < -1;
      })
      .map(label);
    const tinyText = [...document.querySelectorAll('body *')].filter((el) => {
      if (!visible(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) return false;
      return parseFloat(getComputedStyle(el).fontSize) < 12;
    }).length;
    return {
      overflow: document.documentElement.scrollWidth - vw,
      small,
      offscreen,
      tinyText,
    };
  });
  if (SHOTS) {
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/${size}-${view}.png` });
    console.log(
      `[phone] ${size} ${view}: overflow=${report.overflow}px tinyText=${report.tinyText} ` +
        `offscreen=${JSON.stringify(report.offscreen)} small=${JSON.stringify(report.small)}`
    );
  }
  return report;
}

async function openApp(page: Page) {
  await mockTranslation(page);
  await page.goto('/?langs=es,pt');
  await page.getByRole('combobox').first().selectOption('gtx');
}

async function addCaption(page: Page) {
  await page.getByRole('button', { name: 'Test Input' }).click();
  await page
    .getByPlaceholder('Type an English classroom sentence to test translation silently…')
    .fill('Today we will learn about photosynthesis.');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByText('[es] Today we will learn about photosynthesis.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Test Input' }).click();
}

async function openTwoWay(page: Page) {
  await openApp(page);
  await page.getByRole('button', { name: 'Lecture/Conversation' }).click();
  await page.getByRole('button', { name: 'Two-way', exact: true }).click();
}

async function sendTwoWayMessages(page: Page) {
  await page.getByText('Type a message', { exact: true }).click();
  await page.getByLabel('Message text').fill('Hello, how was your day?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Message sender').selectOption('b');
  await page.getByLabel('Message text').fill('Muy bien, gracias.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

async function openLecture(page: Page) {
  await openApp(page);
  await page.getByRole('button', { name: 'Lecture/Conversation' }).click();
  await page.getByRole('button', { name: 'Lecture', exact: true }).click();
}

const views: Record<string, (page: Page) => Promise<void>> = {
  'columns-empty': openApp,
  'test-input': async (page) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Test Input' }).click();
  },
  columns: async (page) => {
    await openApp(page);
    await addCaption(page);
  },
  subtitle: async (page) => {
    await openApp(page);
    await addCaption(page);
    await page.getByRole('button', { name: 'Subtitle', exact: true }).click();
  },
  languages: async (page) => {
    await openApp(page);
    await page
      .getByRole('button', { name: /^Languages/ })
      .first()
      .click();
  },
  settings: async (page) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  },
  guide: async (page) => {
    await openApp(page);
    await page.getByRole('button', { name: 'How to use OverHeard: Guide, FAQ, and Privacy' }).first().click();
  },
  report: async (page) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Something not working? Report a problem' }).first().click();
  },
  'two-way': openTwoWay,
  'two-way-messages': async (page) => {
    await openTwoWay(page);
    await sendTwoWayMessages(page);
  },
  'face-to-face': async (page) => {
    await openTwoWay(page);
    await sendTwoWayMessages(page);
    await page.getByLabel('Layout').selectOption('face-to-face');
  },
  lecture: openLecture,
  'lecture-lines': async (page) => {
    await openLecture(page);
    await page.getByText('Type a line', { exact: true }).click();
    await page.getByLabel('Lecture line text').fill('Plants turn sunlight into food.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
  },
  student: async (page) => {
    await mockTranslation(page);
    const request = page.request;
    const created = await request.post('/api/rooms', { data: { pin: '1234' } });
    const { code, token } = await created.json();
    const put = await request.put(`/api/rooms/${code}`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        entries: [
          {
            id: 'one',
            english: 'Plants turn sunlight into food in their leaves.',
            timestamp: Date.now(),
            translations: { es: 'Las plantas convierten la luz del sol en alimento en sus hojas.' },
            failedLangs: {},
          },
        ],
        removedIds: [],
        selectedLangs: ['es', 'pt'],
        interim: 'This process is called photosynthesis',
        liveTranslations: {},
        isListening: true,
      },
    });
    expect(put.ok()).toBe(true);
    await page.goto(`/?room=${encodeURIComponent(code)}`);
    await expect(page.getByText('Plants turn sunlight into food in their leaves.')).toBeVisible();
  },
};

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    for (const [view, open] of Object.entries(views)) {
      test(`${view} fits the screen`, async ({ page }) => {
        await open(page);
        const report = await check(page, size.name, view);
        if (!SHOTS) expect(report.overflow, `${view} scrolls sideways`).toBe(0);
      });
    }
  });
}
