import { describe, expect, it } from 'vitest';
import { createImportMap, createPreviewDocument, detectFramework } from '../src/core/compiler';

describe('compiler helpers', () => {
  it('detecta React, Preact, Next e Vanilla', () => {
    expect(detectFramework(new Map([['/app/page.tsx', '']]), {})).toBe('next');
    expect(detectFramework(new Map(), { dependencies: { preact: '10' } })).toBe('preact');
    expect(detectFramework(new Map(), { dependencies: { react: '19' } })).toBe('react');
    expect(detectFramework(new Map([['/main.js', '']]), {})).toBe('vanilla');
  });

  it('cria import map com subpaths e singleton de React', () => {
    const map = createImportMap({ dependencies: { react: '^19.2.0', 'react-dom': '^19.2.0', zod: '4.0.0' } });
    expect(map.react).toContain('react@19.2.0');
    expect(map['react-dom/client']).toContain('external=react');
    expect(map.zod).toContain('zod@4.0.0');
    expect(map['zod/']).toMatch(/zod@4\.0\.0\/$/);
  });

  it('monta documento de preview com bridge e scripts escapados', () => {
    const html = createPreviewDocument({
      baseHtml: '<div id="root"></div><script type="module" src="/src/main.ts"></script>',
      javascript: 'console.log("</script>")',
      css: 'body { color: red }',
      importMap: { react: 'https://esm.sh/react' },
      channel: 'test-channel',
    });
    expect(html).toContain('test-channel');
    expect(html).toContain('type="importmap"');
    expect(html).not.toContain('src="/src/main.ts"');
    expect(html).toContain('<\\/script>');
  });
});
