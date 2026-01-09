/**
 * Schedule Generation Types
 * Ders programı oluşturma için type tanımlamaları
 */

import { SubjectTeacherMapping } from '../../types/wizard';

// Günler ve ders saatleri
export const DAYS: string[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
export const PERIODS: string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

export type Day = 'Pazartesi' | 'Salı' | 'Çarşamba' | 'Perşembe' | 'Cuma';
export type Period = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10';

/**
 * Yerleştirme görevi - bir dersin yerleştirilmesi için bilgileri tutar
 */
export interface PlacementTask {
    mapping: SubjectTeacherMapping;
    blockLength: number;
    taskId: string;
    isPlaced: boolean;
}

/**
 * Slot bilgisi - bir zaman diliminde yapılan atamayı temsil eder
 */
export interface ScheduleSlot {
    classId: string;
    teacherId: string;
    subjectId: string;
    isFixed?: boolean;
}

/**
 * Sınıf bazlı program grid'i
 */
export type ClassScheduleGrid = {
    [classId: string]: {
        [day: string]: {
            [period: string]: ScheduleSlot | null;
        };
    };
};

/**
 * Esnek yerleştirme eşiği - bu oranın üzerinde esnek mod aktif olur
 */
export const FLEXIBLE_PLACEMENT_THRESHOLD = 0.95; // %95

/**
 * Korumalı dersler - Bu dersler esnek yerleştirmede taşınamaz
 */
export const PROTECTED_SUBJECT_KEYWORDS = [
    'görsel sanatlar', 'görsel', 'resim',
    'beden eğitimi', 'beden', 'spor',
    'bilişim teknolojileri', 'bilişim', 'bilgisayar',
    'müzik',
    'seçmeli', 'kulüp'
];
