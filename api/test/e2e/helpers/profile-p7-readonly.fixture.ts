export function recursiveReadOnlyAttribute(mutability = 'readOnly') {
  return {
    name: 'nested', type: 'complex', subAttributes: [{
      name: 'records', type: 'complex', multiValued: true, subAttributes: [
        { name: 'value', type: 'string' },
        { name: 'details', type: 'complex', multiValued: true, subAttributes: [
          { name: 'value', type: 'string' }, { name: 'open', type: 'string', required: true },
          { name: 'sealed', type: 'integer', mutability, required: true },
          { name: 'serverBranch', type: 'complex', mutability, subAttributes: [{ name: 'value', type: 'string' }] },
        ] },
      ],
    }],
  };
}

export function recursiveReadOnlyInput(sealed: unknown = 'malformed') {
  return { records: [
    { value: 'r1', details: [{ value: 'd1', open: 'keep-1', sealed, serverBranch: { value: 'stored' } }] },
    { value: 'r2', details: [{ value: 'd2', open: 'keep-2', sealed, serverBranch: { value: 'stored' } }] },
  ] };
}

export function recursiveReadOnlyExpected() {
  return { records: [
    { value: 'r1', details: [{ value: 'd1', open: 'keep-1' }] },
    { value: 'r2', details: [{ value: 'd2', open: 'keep-2' }] },
  ] };
}
