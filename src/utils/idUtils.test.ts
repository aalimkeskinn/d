import { describe, it, expect } from 'vitest';
import { normalizeId, ultraClean } from './idUtils';

describe('normalizeId', () => {
    it('should lowercase and trim', () => {
        expect(normalizeId('  HELLO  ')).toBe('hello');
        expect(normalizeId('Test')).toBe('test');
    });

    it('should handle Turkish characters', () => {
        expect(normalizeId('İSTANBUL')).toBe('istanbul');
        expect(normalizeId('ÖĞRETMEN')).toBe('ogretmen');
    });

    it('should handle empty strings', () => {
        expect(normalizeId('')).toBe('');
    });
});

describe('ultraClean', () => {
    it('should remove all special characters', () => {
        expect(ultraClean('hello-world')).toBe('helloworld');
        expect(ultraClean('test_123')).toBe('test123');
    });

    it('should handle Turkish characters', () => {
        expect(ultraClean('Türkçe')).toBe('turkce');
        expect(ultraClean('Şehir')).toBe('sehir');
    });

    it('should lowercase everything', () => {
        expect(ultraClean('HELLO')).toBe('hello');
    });

    it('should handle spaces', () => {
        expect(ultraClean('hello world')).toBe('helloworld');
    });

    it('should handle complex strings', () => {
        expect(ultraClean('5-A Sınıfı')).toBe('5asinifi');
        expect(ultraClean('Matematik (5. Sınıf)')).toBe('matematik5sinif');
    });
});
