// app/routes/api/snippet.ts

import { json, ActionFunction } from '@remix-run/node';
import { getSession, commitSession } from '~/session.server';
import { shopify } from '~/shopify.server';

// name of the snippet we'll inject
const SNIPPET_KEY = 'snippets/customizer-banner.liquid';
// path to the section we want to patch
const SECTION_KEY = 'sections/main-collection.liquid';
// liquid tag to render our snippet
const RENDER_TAG = `{% render 'customizer-banner' %}`;

export const action: ActionFunction = async ({ request }) => {
  // 1. Authenticate
  const cookie = request.headers.get('Cookie') || '';
  const session = await getSession(cookie);
  const shop = session.get('shop');
  const accessToken = session.get('accessToken');
  if (!shop || !accessToken) {
    return json({ error: 'Not authenticated' }, { status: 401 });
  }

  // 2. Parse form data
  const form = await request.formData();
  const headline = form.get('headlineText');
  const imageUrl = form.get('imageUrl');
  const buttonUrl = form.get('buttonUrl');
  const buttonText = form.get('buttonText') || 'Learn more';

  if (
    typeof headline !== 'string' ||
    typeof imageUrl !== 'string' ||
    typeof buttonUrl !== 'string'
  ) {
    return json({ error: 'Invalid form data' }, { status: 400 });
  }

  // 3. Create a REST client for Admin API
  const client = new shopify.clients.Rest({
    shopName: shop,
    accessToken,
  });

  // 4. Fetch all themes and pick the published one
  const themesRes = await client.get({ path: 'themes' });
  const themes: Array<{ id: number; role: string }> = themesRes.body.themes;
  const mainTheme = themes.find((t) => t.role === 'main');
  if (!mainTheme) {
    return json({ error: 'No published theme found' }, { status: 500 });
  }
  const themeId = mainTheme.id;

  // 5. Build the snippet Liquid content
  const snippetValue = `
<div class="customizer-banner">
  <h1>${headline}</h1>
  <img src="${imageUrl}" alt="Banner image" />
  <a href="${buttonUrl}" class="btn">${buttonText}</a>
</div>`.trim();

  // 6. Upload or update the snippet file
  await client.put({
    path: `themes/${themeId}/assets`,
    data: {
      asset: {
        key: SNIPPET_KEY,
        value: snippetValue,
      },
    },
  });

  // 7. Fetch the target section file
  const sectionRes = await client.get({
    path: `themes/${themeId}/assets`,
    query: { 'asset[key]': SECTION_KEY },
  });
  let sectionValue: string = sectionRes.body.asset.value;

  // 8. Inject the render tag if it’s not already present
  if (!sectionValue.includes(RENDER_TAG)) {
    // Example: insert it right at the top of the section
    sectionValue = sectionValue.replace(
      /(<section[\s\S]*?>)/,
      `$1\n  ${RENDER_TAG}`
    );

    await client.put({
      path: `themes/${themeId}/assets`,
      data: {
        asset: {
          key: SECTION_KEY,
          value: sectionValue,
        },
      },
    });
  }

  // 9. Persist any other state if needed (e.g., DB), then return
  return json({ success: true });
};
