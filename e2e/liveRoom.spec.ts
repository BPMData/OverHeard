import { expect, test } from '@playwright/test';

test('a student receives a teacher’s lecture and the room ending over SSE', async ({ page: teacher, browser, baseURL }) => {
  await teacher.route('**/api/mt', async route => {
    const { text, lang } = route.request().postDataJSON();
    await route.fulfill({ json: { translation: `Teacher ${lang}: ${text}`, provider: 'gtx', ms: 1 } });
  });
  await teacher.goto('/?langs=es');
  await teacher.getByRole('combobox').selectOption('gtx');
  await teacher.getByRole('button', { name: 'Lecture/Conversation' }).click();
  await teacher.getByRole('button', { name: 'Lecture', exact: true }).click();
  await teacher.getByRole('button', { name: 'Share room code with students' }).click();
  await teacher.getByRole('button', { name: 'Create room', exact: true }).click();
  await teacher.getByRole('textbox', { name: 'Room PIN', exact: true }).fill('1234');
  await teacher.getByRole('button', { name: 'Create', exact: true }).click();
  const link = teacher.getByLabel('Student room link');
  await expect(link).toHaveValue(/\/[^/]+$/);
  const code = new URL(await link.inputValue()).pathname.slice(1);

  const studentContext = await browser.newContext({ baseURL });
  try {
    const student = await studentContext.newPage();
    await student.route('**/api/mt', async route => {
      const { text, lang } = route.request().postDataJSON();
      await route.fulfill({ json: { translation: `Student ${lang}: ${text}`, provider: 'gtx', ms: 1 } });
    });
    await student.goto(`/?room=${encodeURIComponent(code)}`);
    await expect(student.getByText('Connected · Teacher paused')).toBeVisible();
    await expect(student.getByText('Waiting for your teacher. Captions will appear here as the lecture begins.')).toBeVisible();

    await teacher.getByText('Type a line', { exact: true }).click();
    await teacher.getByLabel('Lecture line text').fill('Cells divide by mitosis.');
    await teacher.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(student.getByText('Cells divide by mitosis.', { exact: true })).toBeVisible();
    await expect(student.getByText('Teacher es: Cells divide by mitosis.', { exact: true })).toBeVisible();

    teacher.on('dialog', dialog => dialog.accept());
    await teacher.getByRole('button', { name: 'End room', exact: true }).click();
    await expect(student.getByText('This lecture has ended.')).toBeVisible();
    await expect(student.getByText('Cells divide by mitosis.', { exact: true })).toBeVisible();
  } finally {
    await studentContext.close();
  }
});
