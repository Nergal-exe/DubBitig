import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The themes in src/design-styles.css are generated from docs/design-dna/*.json (Design DNA schema).
// These checks keep them in sync: every colour token comes from the DNA and every text pair meets WCAG AA.
const root = join(import.meta.dirname, '..');
const css = readFileSync(join(root, 'src/design-styles.css'), 'utf8');
const themes = ['fluent', 'macos', 'material'] as const;
const dna = Object.fromEntries(themes.map(t => [t, JSON.parse(readFileSync(join(root, 'docs/design-dna', `${t}.json`), 'utf8'))]));

function block(selector: string) {
  const start = css.indexOf(selector + ' {');
  assert.ok(start >= 0, 'CSS bloğu yok: ' + selector);
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6,8})\b/g)].map(m => [m[1], m[2].toUpperCase()]));
}
const modes = (t: string) => ({ dark: block(`:root[data-style="${t}"]:not([data-theme="light"])`), light: block(`:root[data-style="${t}"][data-theme="light"]`) });
const luminance = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('her tema DNA dosyası şemanın üç boyutunu ve temel belirteçleri içerir', () => {
  for (const t of themes) {
    const d = dna[t];
    for (const key of ['meta', 'design_system', 'design_style', 'visual_effects']) assert.ok(d[key], `${t}: ${key} yok`);
    for (const path of ['color.primary.hex', 'color.accent.hex', 'color.surface.background', 'color.dark_mode.surface.background', 'typography.font_families.body', 'shape.border_radius.small', 'elevation.levels.low', 'motion.easing', 'components.button_style']) {
      assert.ok(path.split('.').reduce((o, k) => o?.[k], d.design_system), `${t}: design_system.${path} yok`);
    }
    assert.match(d.design_system.motion.easing, /^cubic-bezier\(/);
    assert.ok(css.includes(d.design_system.motion.easing), `${t}: DNA hareket eğrisi CSS'te kullanılmıyor`);
  }
});

test('CSS teması yalnızca kendi DNA dosyasındaki renkleri kullanır', () => {
  for (const t of themes) {
    const source = JSON.stringify(dna[t]).toUpperCase();
    for (const [mode, tokens] of Object.entries(modes(t))) {
      assert.ok(Object.keys(tokens).length >= 20, `${t}/${mode}: renk belirteçleri eksik`);
      for (const [name, hex] of Object.entries(tokens)) assert.ok(source.includes(hex), `${t}/${mode}: --${name} ${hex} DNA'da yok`);
    }
  }
});

test('her temada metin ve dolgu renkleri WCAG AA (4.5:1) kontrastını sağlar', () => {
  for (const t of themes) {
    for (const [mode, c] of Object.entries(modes(t))) {
      const pairs: [string, string][] = [];
      for (const bg of ['canvas', 'surface', 'raised', 'sidebar']) for (const fg of ['ink', 'muted', 'subtle', 'danger', 'success', 'warning']) pairs.push([fg, bg]);
      pairs.push(['ink', 'hover'], ['muted', 'hover']);
      pairs.push(t === 'macos' ? ['accent-ink', 'mac-fill'] : ['accent-ink', 'accent']);
      if (t === 'material') pairs.push(['md-on-primary-container', 'md-primary-container'], ['md-on-secondary-container', 'accent-soft'], ['accent', 'md-container-high']);
      if (t === 'fluent') pairs.push(['ink', 'fl-selected'], ['accent', 'surface']);
      if (t === 'macos') pairs.push(['accent', 'surface']);
      for (const [fg, bg] of pairs) {
        assert.ok(c[fg] && c[bg], `${t}/${mode}: --${fg} veya --${bg} tanımlı değil`);
        const ratio = contrast(c[fg], c[bg]);
        assert.ok(ratio >= 4.5, `${t}/${mode}: --${fg} ${c[fg]} / --${bg} ${c[bg]} kontrastı ${ratio.toFixed(2)}:1`);
      }
    }
  }
});
