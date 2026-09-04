declare const userBrand: unique symbol;
export type UserId = string & { readonly [userBrand]: 'UserId' };

export function userId(value: string): UserId {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new RangeError('User id cannot be empty');
  }
  return trimmed as UserId;
}
