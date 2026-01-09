/**
 * Schedule Generation Utilities
 * Ders programı oluşturma için yardımcı fonksiyonlar
 */

import { PROTECTED_SUBJECT_KEYWORDS } from './types';

/**
 * Bir dersin korumalı olup olmadığını kontrol eder.
 * Korumalı dersler: Görsel Sanatlar, Beden Eğitimi, Bilişim, Müzik, Seçmeli
 * Bu dersler esnek yerleştirme sırasında taşınamaz.
 */
export const isProtectedSubject = (subjectName: string): boolean => {
    if (!subjectName) return false;
    const clean = subjectName.toLowerCase().trim();
    return PROTECTED_SUBJECT_KEYWORDS.some(keyword => clean.includes(keyword));
};

/**
 * Haftalık saate göre optimal dağıtım oluşturur.
 * Mümkün olduğunca 2 saatlik bloklar, kalan 1'lik.
 * Örn: 5 → [2,2,1], 6 → [2,2,2], 7 → [2,2,2,1], 8 → [2,2,2,2]
 */
export const generateOptimalDistribution = (weeklyHours: number): number[] => {
    const distribution: number[] = [];
    let remaining = weeklyHours;

    // Önce mümkün olduğunca 2'lik bloklar ekle
    while (remaining >= 2) {
        distribution.push(2);
        remaining -= 2;
    }

    // Kalan 1 saat varsa ekle
    if (remaining === 1) {
        distribution.push(1);
    }

    return distribution;
};

/**
 * Fisher-Yates shuffle algoritması ile diziyi karıştırır
 */
export const shuffleArray = <T>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

/**
 * Gün ve periyot bazlı benzersiz anahtar üretir
 */
export const getSlotKey = (day: string, period: string): string => {
    return `${day}-${period}`;
};

/**
 * Slot key'i parse eder
 */
export const parseSlotKey = (key: string): { day: string; period: string } => {
    const [day, period] = key.split('-');
    return { day, period };
};
