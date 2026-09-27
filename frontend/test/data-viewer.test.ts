import { describe, expect, it } from 'vitest';
import { chartColumns, chartData, compareValues, parseTextData } from '../src/plugins/data-viewer/data';

describe('data viewer parsing', () => {
  it('parses CSV quoting, embedded commas, and numeric values', () => {
    const parsed = parseTextData('city,score,note\nOslo,3,"cold, dry"\nRome,5,warm', '.csv');
    expect(parsed.columns).toEqual(['city', 'score', 'note']);
    expect(parsed.rows[0]).toEqual({ city: 'Oslo', score: 3, note: 'cold, dry' });
  });
  it('parses TSV and JSON arrays of records', () => {
    expect(parseTextData('name\tcount\na\t2', '.tsv').rows[0].count).toBe(2);
    expect(parseTextData('[{"a":1},{"b":2}]', '.json').columns).toEqual(['a', 'b']);
  });
  it('unwraps common JSON record arrays and reads JSON Lines', () => {
    expect(parseTextData('{"results":[{"name":"A"}]}', '.json').rows).toEqual([{ name: 'A' }]);
    expect(parseTextData('{"x":1}\n{"x":2}', '.jsonl').rows).toHaveLength(2);
    expect(() => parseTextData('{bad}', '.jsonl')).toThrow('line 1');
  });
  it('sorts numeric values and groups chart values by average', () => {
    const rows = [{ group: 'b', score: 4 }, { group: 'a', score: 2 }, { group: 'b', score: 6 }];
    expect(compareValues(10, 2)).toBeGreaterThan(0);
    expect(chartColumns(rows, ['group', 'score']).y).toEqual(['score']);
    expect(chartData(rows, 'group', 'score')).toEqual([{ label: 'b', value: 5 }, { label: 'a', value: 2 }]);
  });
  it('rejects text files beyond the preview limit', () => {
    expect(() => parseTextData('x'.repeat(10 * 1024 * 1024 + 1), '.csv')).toThrow('10 MB');
  });
});
