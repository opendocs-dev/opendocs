import { expect, test } from 'bun:test';
import { escapeCsv } from './assistant';

test('escapeCsv neutralises spreadsheet formulas and still quotes commas', () => {
  expect(escapeCsv('=1+1')).toBe("'=1+1");
  expect(escapeCsv('@SUM(A1)')).toBe("'@SUM(A1)");
  expect(escapeCsv('-2')).toBe("'-2");
  expect(escapeCsv('a,b')).toBe('"a,b"');
  expect(escapeCsv('plain')).toBe('plain');
});
