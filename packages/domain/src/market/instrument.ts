/**
 * A thing that can be watched. A ticker symbol, for now.
 */
declare const instrumentBrand: unique symbol;
export type InstrumentId = string & { readonly [instrumentBrand]: 'InstrumentId' };

export function instrumentId(value: string): InstrumentId {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new RangeError('Instrument id cannot be empty');
  }
  return trimmed as InstrumentId;
}
