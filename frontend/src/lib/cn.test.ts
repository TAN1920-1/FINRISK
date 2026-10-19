import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('flex', 'items-center')).toBe('flex items-center');
  });

  it('lets a later Tailwind class win a conflict', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('drops falsy inputs so conditional classes stay readable', () => {
    expect(cn('text-sm', false && 'hidden', null, undefined, '')).toBe('text-sm');
  });

  it('supports the object form for conditional classes', () => {
    expect(cn({ truncate: true, flex: false }, 'text-sm')).toBe('truncate text-sm');
  });

  it('resolves a conflict between a conditional class and a later one', () => {
    // `hidden` and `block` are both display utilities, so the later one wins.
    expect(cn({ hidden: true }, 'block')).toBe('block');
  });
});
