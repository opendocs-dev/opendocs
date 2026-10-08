import { describe, expect, test } from 'bun:test';

import { splitInline } from './inline-bold';

describe('splitInline', () => {
  test('plain text with no markers', () => {
    expect(splitInline('Click Save')).toEqual([{ kind: 'text', text: 'Click Save' }]);
  });

  test('one bold span', () => {
    expect(splitInline('Click **Add to cart**')).toEqual([
      { kind: 'text', text: 'Click ' },
      { kind: 'bold', text: 'Add to cart' },
    ]);
  });

  test('two bold spans', () => {
    expect(splitInline('Click **Add to cart** then **Checkout**')).toEqual([
      { kind: 'text', text: 'Click ' },
      { kind: 'bold', text: 'Add to cart' },
      { kind: 'text', text: ' then ' },
      { kind: 'bold', text: 'Checkout' },
    ]);
  });

  test('unbalanced opening bold marker stays plain', () => {
    expect(splitInline('**a')).toEqual([{ kind: 'text', text: '**a' }]);
  });

  test('leading space inside bold markers is not bold', () => {
    expect(splitInline('** a**')).toEqual([{ kind: 'text', text: '** a**' }]);
  });

  test('three asterisks stay plain', () => {
    expect(splitInline('***')).toEqual([{ kind: 'text', text: '***' }]);
  });

  test('empty bold span stays plain', () => {
    expect(splitInline('****')).toEqual([{ kind: 'text', text: '****' }]);
  });

  test('one code span', () => {
    expect(splitInline('save `Bun_(software).pdf`')).toEqual([
      { kind: 'text', text: 'save ' },
      { kind: 'code', text: 'Bun_(software).pdf' },
    ]);
  });

  test('code containing ** stays literal, not parsed as bold', () => {
    expect(splitInline('run `a**b**c`')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'a**b**c' },
    ]);
  });

  test('bold and code in one line', () => {
    expect(splitInline('Click **Save** then run `build.sh`')).toEqual([
      { kind: 'text', text: 'Click ' },
      { kind: 'bold', text: 'Save' },
      { kind: 'text', text: ' then run ' },
      { kind: 'code', text: 'build.sh' },
    ]);
  });

  test('unbalanced backtick stays text', () => {
    expect(splitInline('a `b')).toEqual([{ kind: 'text', text: 'a `b' }]);
  });

  test('empty code span stays plain', () => {
    expect(splitInline('``')).toEqual([{ kind: 'text', text: '``' }]);
  });
});
