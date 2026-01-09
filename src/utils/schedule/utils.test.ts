import { describe, it, expect } from 'vitest';
import { isProtectedSubject, generateOptimalDistribution, shuffleArray, getSlotKey, parseSlotKey } from './utils';

describe('isProtectedSubject', () => {
    it('should identify protected subjects (non-core subjects)', () => {
        // Protected = Görsel Sanatlar, Beden Eğitimi, Bilişim, Müzik, Seçmeli
        expect(isProtectedSubject('görsel sanatlar')).toBe(true);
        expect(isProtectedSubject('beden eğitimi')).toBe(true);
        expect(isProtectedSubject('müzik')).toBe(true);
        expect(isProtectedSubject('bilişim')).toBe(true);
        expect(isProtectedSubject('seçmeli')).toBe(true);
    });

    it('should return false for core subjects', () => {
        expect(isProtectedSubject('matematik')).toBe(false);
        expect(isProtectedSubject('türkçe')).toBe(false);
        expect(isProtectedSubject('fen bilimleri')).toBe(false);
        expect(isProtectedSubject('ingilizce')).toBe(false);
    });

    it('should handle empty strings', () => {
        expect(isProtectedSubject('')).toBe(false);
    });

    it('should be case insensitive', () => {
        expect(isProtectedSubject('GÖRSEL SANATLAR')).toBe(true);
        expect(isProtectedSubject('Müzik')).toBe(true);
    });
});

describe('generateOptimalDistribution', () => {
    it('should return empty array for 0 hours', () => {
        expect(generateOptimalDistribution(0)).toEqual([]);
    });

    it('should distribute 5 hours as [2,2,1]', () => {
        expect(generateOptimalDistribution(5)).toEqual([2, 2, 1]);
    });

    it('should distribute 6 hours as [2,2,2]', () => {
        expect(generateOptimalDistribution(6)).toEqual([2, 2, 2]);
    });

    it('should distribute 7 hours as [2,2,2,1]', () => {
        expect(generateOptimalDistribution(7)).toEqual([2, 2, 2, 1]);
    });

    it('should distribute 8 hours as [2,2,2,2]', () => {
        expect(generateOptimalDistribution(8)).toEqual([2, 2, 2, 2]);
    });

    it('should distribute 1 hour as [1]', () => {
        expect(generateOptimalDistribution(1)).toEqual([1]);
    });

    it('should distribute 3 hours as [2,1]', () => {
        expect(generateOptimalDistribution(3)).toEqual([2, 1]);
    });
});

describe('shuffleArray', () => {
    it('should return array with same length', () => {
        const arr = [1, 2, 3, 4, 5];
        expect(shuffleArray(arr).length).toBe(arr.length);
    });

    it('should contain same elements', () => {
        const arr = [1, 2, 3, 4, 5];
        const shuffled = shuffleArray(arr);
        arr.forEach(item => {
            expect(shuffled).toContain(item);
        });
    });

    it('should not modify original array', () => {
        const arr = [1, 2, 3];
        shuffleArray(arr);
        expect(arr).toEqual([1, 2, 3]);
    });
});

describe('getSlotKey and parseSlotKey', () => {
    it('should create correct slot key', () => {
        expect(getSlotKey('Pazartesi', '1')).toBe('Pazartesi-1');
        expect(getSlotKey('Cuma', '8')).toBe('Cuma-8');
    });

    it('should parse slot key correctly', () => {
        expect(parseSlotKey('Pazartesi-1')).toEqual({ day: 'Pazartesi', period: '1' });
        expect(parseSlotKey('Cuma-8')).toEqual({ day: 'Cuma', period: '8' });
    });
});
