import { describe, it, expect } from 'vitest';
import { slugify } from './slugify';

describe('slugify', () => {
    it('should convert Turkish characters', () => {
        expect(slugify('Türkçe')).toBe('turkce');
        expect(slugify('İstanbul')).toBe('istanbul');
        expect(slugify('ÖĞRETMEN')).toBe('ogretmen');
        expect(slugify('Şehir')).toBe('sehir');
        expect(slugify('Çocuk')).toBe('cocuk');
        expect(slugify('Güneş')).toBe('gunes');
    });

    it('should convert spaces to hyphens', () => {
        expect(slugify('hello world')).toBe('hello-world');
        expect(slugify('Ders Programı')).toBe('ders-programi');
    });

    it('should convert to lowercase', () => {
        expect(slugify('HELLO')).toBe('hello');
        expect(slugify('HeLLo WoRLD')).toBe('hello-world');
    });

    it('should remove special characters', () => {
        expect(slugify('hello@world!')).toBe('helloworld');
        expect(slugify('test#123')).toBe('test123');
    });

    it('should handle empty strings', () => {
        expect(slugify('')).toBe('');
    });

    it('should handle multiple spaces', () => {
        expect(slugify('hello   world')).toBe('hello-world');
    });

    it('should handle mixed content', () => {
        expect(slugify('5A Sınıfı - Matematik')).toBe('5a-sinifi-matematik');
    });
});
