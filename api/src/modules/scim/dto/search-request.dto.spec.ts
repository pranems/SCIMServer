import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchRequestDto } from './search-request.dto';
import { searchAttributeSelectionToQuery } from './search-attribute-selection';

describe('SearchRequestDto projection boundary', () => {
  it('adapts JSON arrays without changing legacy strings or shared inputs', () => {
    const selection = ['name.givenName', 'urn:example:extension:2.0:Example:department'];
    expect(searchAttributeSelectionToQuery(selection)).toBe(selection.join(','));
    expect(selection).toEqual(['name.givenName', 'urn:example:extension:2.0:Example:department']);
    expect(searchAttributeSelectionToQuery('userName,displayName')).toBe('userName,displayName');
    expect(searchAttributeSelectionToQuery([])).toBe('');
    expect(searchAttributeSelectionToQuery(undefined)).toBeUndefined();
  });
  describe.each(['attributes', 'excludedAttributes'])('%s', (field) => {
    it.each([
      ['RFC array', ['userName', 'name.givenName']],
      ['empty array', []],
      ['legacy comma-separated string', 'userName,name.givenName'],
      ['legacy empty string', ''],
      ['maximum string', 'a'.repeat(2000)],
      ['maximum aggregate array', ['a'.repeat(999), 'b'.repeat(1000)]],
      ['maximum item count', Array.from({ length: 100 }, () => 'id')],
    ])('accepts %s', async (_label, value) => {
      expect(await validate(plainToInstance(SearchRequestDto, { [field]: value }))).toEqual([]);
    });

    it.each([
      ['object', { name: 'userName' }],
      ['number', 12],
      ['null', null],
      ['mixed array', ['userName', 12]],
      ['object array', [{ name: 'userName' }]],
      ['nested array', [['userName']]],
      ['null element', ['userName', null]],
      ['empty element', ['']],
      ['blank element', ['  ']],
      ['embedded delimiter', ['userName,displayName']],
      ['too many elements', Array.from({ length: 101 }, () => 'id')],
      ['oversized string', 'a'.repeat(2001)],
      ['oversized aggregate array', ['a'.repeat(1000), 'b'.repeat(1000)]],
    ])('rejects %s without coercion', async (_label, value) => {
      const errors = await validate(plainToInstance(SearchRequestDto, { [field]: value }));
      expect(errors.map((error) => error.property)).toContain(field);
    });
  });
});
