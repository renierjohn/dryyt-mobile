import { Brand, Colors } from '@/constants/theme';

it('defines the same tokens in light and dark', () => {
  expect(Object.keys(Colors.dark).sort()).toEqual(Object.keys(Colors.light).sort());
});

it('uses the logo blue as primary', () => {
  expect(Colors.light.primary).toBe('#3B82F6');
  expect(Colors.dark.primary).toBe('#3B82F6');
  expect(Brand.primary).toBe('#3B82F6');
});
