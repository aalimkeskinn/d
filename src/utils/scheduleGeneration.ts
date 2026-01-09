import { Teacher, Class, Subject, Schedule } from '../types/index';
import { TimeConstraint } from '../types/constraints';
import { WizardData, SubjectTeacherMapping, EnhancedGenerationResult, FixedSlot } from '../types/wizard';
import { getEntityLevel } from './subjectTeacherMapping';
import { slugify } from './slugify';
import { normalizeId, ultraClean } from './idUtils';

// Grid tipleri - Bu dosyadaki grid yapısı çok dinamik, any kullanımı pragmatik tercih
/* eslint-disable @typescript-eslint/no-explicit-any */
type ScheduleGrid = { [classId: string]: any };

// Yeni modüllerden import
import {
    DAYS,
    PERIODS,
    FLEXIBLE_PLACEMENT_THRESHOLD,
    PlacementTask
} from './schedule/types';
import {
    isProtectedSubject,
    generateOptimalDistribution
} from './schedule/utils';

// Re-export for backward compatibility
export { DAYS, PERIODS } from './schedule/types';
export type { PlacementTask } from './schedule/types';
export { isProtectedSubject, generateOptimalDistribution } from './schedule/utils';


const runSingleAttempt = (
    mappings: SubjectTeacherMapping[],
    allClasses: Class[],
    allTeachers: Teacher[],
    allSubjects: Subject[],
    timeConstraints: TimeConstraint[],
    failureCounts?: Map<string, number>,
    initialSchedules?: { teacherId: string, schedule: Schedule['schedule'] }[],
    resourceTypeCache?: Map<string, string | null>,
    globalRules?: WizardData['constraints']['globalRules'],
    fixedSlots?: FixedSlot[]  // YENİ: Sabit ders yerleştirme
): { grid: ScheduleGrid, tasks: PlacementTask[], placedCount: number, conflictCount: number } => {
    const getResourceType = (mapping: { subjectId: string; teacherId?: string }): string | null => {
        const cacheKey = `${mapping.subjectId}-${mapping.teacherId || 'no-teacher'}`;
        const cached = resourceTypeCache?.get(cacheKey);
        if (cached !== undefined) return cached;

        // EMERGENCY FALLBACK: If cache is missing (should not happen), re-calculate
        const subject = allSubjects.find(s => s.id === mapping.subjectId);
        const name = subject?.name.toUpperCase() || '';
        if (name.includes('BİLİŞİM') || name.includes('TEKNOLOJİ')) return 'IT_ROOM';
        if (name.includes('BEDEN') || name.includes('SPOR')) return 'GYM';

        return null;
    };

    /**
     * Sanal sınıf ID'lerini çözümler. 
     * Key simetrisi için kritik.
     */
    const getRealClassId = (cId: string): string => {
        if (cId.startsWith('kulup-virtual-class-')) return cId.replace('kulup-virtual-class-', '');
        if (cId.startsWith('generic-class-kulup-')) return cId.replace('generic-class-kulup-', '');
        return cId;
    };

    /**
     * V8 KESIN ÇÖZÜM: Mapping'den gelen subjectName'i kullan.
     * Bu, allSubjects parametresine bağımlılığı ortadan kaldırır.
     */
    const mappingSubjectNames = new Map<string, string>();
    mappings.forEach(m => {
        if (m.subjectName && !mappingSubjectNames.has(m.subjectId)) {
            mappingSubjectNames.set(m.subjectId, m.subjectName);
        }
    });
    // Fallback: allSubjects'tan da doldur (initialSchedules için)
    allSubjects.forEach(s => {
        if (!mappingSubjectNames.has(s.id)) {
            mappingSubjectNames.set(s.id, s.name || s.id);
        }
    });

    /**
     * V11: Subject.name bazlı key üretici (DEBUG logları temizlendi)
     * Dağıtım kuralları için ders adı bazlı key üretir.
     */
    const getSafeBlockKey = (sId: string, cId: string, d: string): string => {
        const subName = mappingSubjectNames.get(sId) || sId;
        const cleanS = ultraClean(subName);
        const cleanC = ultraClean(getRealClassId(cId));
        return `${cleanS}::${cleanC}::${d}`;
    };
    const classScheduleGrids: ScheduleGrid = {};
    const teacherAvailability = new Map<string, Set<string>>();
    const classAvailability = new Map<string, Set<string>>();
    const resourceAvailability = new Map<string, string[]>(); // key: "day-period-resourceType", value: taskId[]
    const constraintMap = new Map<string, string>();
    const teacherDailyTotalHours = new Map<string, Map<string, number>>();
    const teacherClassDailyHours = new Map<string, Map<string, Map<string, number>>>();
    const teacherWeeklyTarget = new Map<string, number>();

    // *** YENİ: Subject-Class-Day bazlı blok takibi ***
    // Key: `${subjectId}::${classId}::${day}` - Bu kombinasyona blok yerleştirildi mi?
    const subjectClassDayBlocks = new Set<string>();

    const superClean = ultraClean; // Use the robust Turkish-aware utility
    const superCleanMap = new Map<string, string>();

    const getSafeLevel = (classId: string, teacherId: string): 'Anaokulu' | 'İlkokul' | 'Ortaokul' => {
        if (classId === 'KULÜP' || classId.startsWith('kulup-virtual-class-')) {
            const teacher = allTeachers.find(t => t.id === teacherId);
            return teacher ? getEntityLevel(teacher) : 'İlkokul';
        }
        const classItem = allClasses.find(c => c.id === classId);
        return classItem ? getEntityLevel(classItem) : 'İlkokul';
    };

    timeConstraints.forEach(c => {
        if (c.constraintType) {
            const entityType = c.entityType?.toLowerCase().replace(/s$/, '') || '';
            const normId = normalizeId(c.entityId, entityType);
            const scId = superClean(c.entityId);

            // Set basic constraints
            constraintMap.set(`${entityType}-${c.entityId}-${c.day}-${c.period}`, c.constraintType);
            constraintMap.set(`${entityType}-${normId}-${c.day}-${c.period}`, c.constraintType);
            superCleanMap.set(`${entityType}-${scId}-${c.day}-${c.period}`, c.constraintType);

            if (entityType === 'subject') {
                // Try to find subject by ID or by name inside the ID
                let subject = allSubjects.find(s => s.id === c.entityId || s.id === normId);
                if (!subject) {
                    const cleanId = c.entityId.replace(/^sub-/, '');
                    subject = allSubjects.find(s => superClean(s.name) === superClean(cleanId) || superClean(s.id).includes(superClean(cleanId)));
                }

                if (subject) {
                    const nameKey = slugify(subject.name);
                    constraintMap.set(`subjectname-${nameKey}-${c.day}-${c.period}`, c.constraintType);
                }
            }
        }
    });


    // TÜM sınıfları topla: mappings + fixedSlots
    const selectedClassIds = new Set(mappings.map(m => m.classId));
    // fixedSlots'tan sınıfları ekle
    if (fixedSlots) {
        fixedSlots.forEach(slot => selectedClassIds.add(slot.classId));
    }
    selectedClassIds.forEach(classId => {
        const classItem = allClasses.find(c => c.id === classId);

        if (classItem && classId !== 'KULÜP') {
            classScheduleGrids[classId] = {};
            classAvailability.set(classId, new Set<string>());
            DAYS.forEach(day => { classScheduleGrids[classId][day] = {}; });
            const lunchPeriod = getEntityLevel(classItem) === 'Ortaokul' ? '6' : '5';
            if (PERIODS.includes(lunchPeriod)) {
                DAYS.forEach(day => {
                    classScheduleGrids[classId][day][lunchPeriod] = { isFixed: true, classId: 'fixed-period', subjectId: 'Yemek' };
                    classAvailability.get(classId)!.add(`${day}-${lunchPeriod}`);
                });
            }
        } else if (classId.startsWith('kulup-virtual-class-')) {
            // Initialize grid for virtual club classes
            classScheduleGrids[classId] = {};
            classAvailability.set(classId, new Set<string>());
            DAYS.forEach(day => { classScheduleGrids[classId][day] = {}; });
        }
    });

    // Ensure KULÜP virtual class grid exists
    if (!classScheduleGrids['KULÜP']) {
        classScheduleGrids['KULÜP'] = {};
        classAvailability.set('KULÜP', new Set<string>());
        DAYS.forEach(day => { classScheduleGrids['KULÜP'][day] = {}; });
    }

    const teacherLoad = new Map<string, number>();
    const classLoad = new Map<string, number>();
    mappings.forEach(m => {
        teacherLoad.set(m.teacherId, (teacherLoad.get(m.teacherId) || 0) + m.weeklyHours);
        classLoad.set(m.classId, (classLoad.get(m.classId) || 0) + m.weeklyHours);
    });

    // AKILLI DENGELEME: Her öğretmen için ideal günlük yük hesapla
    // Örnek: 24 saat = 24/5 = 4.8 → bazı günler 5, bazıları 4 (toplam: 5+5+5+5+4=24)
    const teacherIdealDailyHigh = new Map<string, number>(); // Yüksek hedef (ceil)
    const teacherIdealDailyLow = new Map<string, number>();  // Düşük hedef (floor)
    const teacherHighDayCount = new Map<string, number>();   // Kaç gün yüksek olmalı

    // TÜM öğretmenleri topla: mappings + initialSchedules + fixedSlots
    const selectedTeacherIds = new Set(mappings.map(m => m.teacherId));
    // initialSchedules'dan öğretmenleri ekle
    if (initialSchedules) {
        initialSchedules.forEach(s => selectedTeacherIds.add(s.teacherId));
    }
    // fixedSlots'tan öğretmenleri ekle
    if (fixedSlots) {
        fixedSlots.forEach(slot => selectedTeacherIds.add(slot.teacherId));
    }
    selectedTeacherIds.forEach(teacherId => {
        teacherAvailability.set(teacherId, new Set<string>());
        teacherDailyTotalHours.set(teacherId, new Map());
        teacherClassDailyHours.set(teacherId, new Map());
        DAYS.forEach(d => teacherDailyTotalHours.get(teacherId)!.set(d, 0));

        const weeklyLoad = teacherLoad.get(teacherId) || 1;
        const dailyLimit = weeklyLoad >= 28 ? 7 : 6;

        // İdeal dağılım hesapla
        const baseDaily = Math.floor(weeklyLoad / 5);        // Temel günlük (düşük)
        const remainder = weeklyLoad % 5;                     // Kalan saatler
        const highDaily = Math.min(baseDaily + 1, dailyLimit); // Yüksek günlük (limit içinde)

        teacherIdealDailyLow.set(teacherId, baseDaily);
        teacherIdealDailyHigh.set(teacherId, highDaily);
        teacherHighDayCount.set(teacherId, remainder);        // Kaç gün yüksek olmalı
        teacherWeeklyTarget.set(teacherId, Math.max(1, highDaily)); // Eski uyumluluk için
    });

    // Pre-calculate super-clean IDs for all relevant entities to avoid repeated slugification
    const teacherSCIds = new Map<string, string>();
    selectedTeacherIds.forEach(id => teacherSCIds.set(id, superClean(id)));
    const classSCIds = new Map<string, string>();
    selectedClassIds.forEach(id => classSCIds.set(id, superClean(id)));
    // Subject ID normalizasyonuna gerek kalmadı (V5)
    // Sadece realClassId helper'ı kullanacağız.

    // --- NEW: Process Initial Schedules if provided ---
    if (initialSchedules) {
        initialSchedules.forEach(scheduleItem => {
            const { teacherId, schedule } = scheduleItem;
            Object.entries(schedule).forEach(([day, periods]) => {
                Object.entries(periods).forEach(([period, slot]) => {
                    if (slot && slot.classId) {
                        const classId = slot.classId;
                        const realClassId = getRealClassId(classId);

                        // 1. Mark in Class Grid (using REAL ID)
                        if (classScheduleGrids[realClassId]) {
                            classScheduleGrids[realClassId][day][period] = { ...slot, teacherId, isFixed: true };
                            if (!classAvailability.has(realClassId)) {
                                classAvailability.set(realClassId, new Set<string>());
                            }
                            classAvailability.get(realClassId)!.add(`${day}-${period}`);
                        }
                        // Also mark the virtual grid if it exists, just in case
                        if (realClassId !== classId && classScheduleGrids[classId]) {
                            classScheduleGrids[classId][day][period] = { ...slot, teacherId, isFixed: true };
                            if (!classAvailability.has(classId)) {
                                classAvailability.set(classId, new Set<string>());
                            }
                            classAvailability.get(classId)!.add(`${day}-${period}`);
                        }
                        // 2. Mark in Teacher Availability - Map'te yoksa önce ekle
                        if (!teacherAvailability.has(teacherId)) {
                            teacherAvailability.set(teacherId, new Set<string>());
                        }
                        teacherAvailability.get(teacherId)!.add(`${day}-${period}`);
                        // 3. Update Teacher-Class Daily Hours & Teacher Daily Total
                        const tId = teacherId;
                        const d = day;

                        // Total Daily Load
                        const dailyTotalMap = teacherDailyTotalHours.get(tId);
                        if (dailyTotalMap) dailyTotalMap.set(d, (dailyTotalMap.get(d) || 0) + 1);

                        // Class Specific Load
                        const tMap = teacherClassDailyHours.get(tId);
                        if (tMap) {
                            if (!tMap.has(classId)) tMap.set(classId, new Map());
                            const cMap = tMap.get(classId)!;
                            cMap.set(d, (cMap.get(d) || 0) + 1);
                        }

                        // *** YENİ: Subject-Class-Day bloğu işaretle (initial schedules) ***
                        if (slot.subjectId) {
                            subjectClassDayBlocks.add(getSafeBlockKey(slot.subjectId, classId, d));
                        }
                        // 4. Update Resource Availability
                        if (slot.subjectId) {
                            const resType = getResourceType({ subjectId: slot.subjectId, teacherId });
                            if (resType) {
                                const key = `${day}-${period}-${resType}`;
                                if (!resourceAvailability.has(key)) resourceAvailability.set(key, []);
                                resourceAvailability.get(key)!.push(`initial-${teacherId}`);
                            }
                        }
                    }
                });
            });
        });
    }

    // *** SABİT DERSLER İÇİN MAPPING'LERİN WEEKLY HOURS DEĞERINI AZALT VE AVAILABILITY GÜNCELLE ***
    // Bu sayede sabit dersler için fazla task oluşturulmaz ve öğretmenler bu saatlerde meşgul görünür
    const adjustedMappings = mappings.map(m => ({ ...m })); // Kopyasını al

    if (fixedSlots && fixedSlots.length > 0) {


        // Sabit slot sayılarını hesapla
        const fixedSlotCounts = new Map<string, number>();
        fixedSlots.forEach(slot => {
            const key = `${slot.teacherId}|||${slot.classId}|||${slot.subjectId}`;
            fixedSlotCounts.set(key, (fixedSlotCounts.get(key) || 0) + 1);

            // ÖNEMLİ: Öğretmen ve sınıf availability'i ŞİMDİ güncelle
            // Böylece normal ders yerleştirmede bu saatler dolu görünür
            const teacherKey = `${slot.day}-${slot.period}`;

            // Öğretmen availability güncelle
            if (teacherAvailability.has(slot.teacherId)) {
                teacherAvailability.get(slot.teacherId)!.add(teacherKey);
            }

            // Sınıf availability güncelle
            if (classAvailability.has(slot.classId)) {
                classAvailability.get(slot.classId)!.add(teacherKey);
            }

            // Günlük saat sayaçlarını güncelle
            const dailyMap = teacherDailyTotalHours.get(slot.teacherId);
            if (dailyMap) {
                dailyMap.set(slot.day, (dailyMap.get(slot.day) || 0) + 1);
            }


        });

        // Mapping'lerin weeklyHours değerini azalt
        adjustedMappings.forEach(mapping => {
            // Bu mapping için sabit slot var mı kontrol et
            fixedSlotCounts.forEach((count, key) => {
                const [teacherId, classId, subjectId] = key.split('|||');

                if (mapping.teacherId === teacherId && mapping.classId === classId) {
                    // Subject eşleştirmesi
                    const mappingSubjectId = mapping.subjectId.toLowerCase().trim();
                    const slotSubjectId = subjectId.toLowerCase().trim();

                    if (mappingSubjectId === slotSubjectId ||
                        mappingSubjectId.includes(slotSubjectId) ||
                        slotSubjectId.includes(mappingSubjectId)) {
                        // Bu mapping'in weeklyHours'ını azalt (sabit dersler grid'e ayrıca yerleştirilecek)
                        mapping.weeklyHours = Math.max(0, mapping.weeklyHours - count);
                    }
                }
            });
        });
    }

    const clubTasks: PlacementTask[] = [];
    const blockTasks: PlacementTask[] = [];
    const singleHourTasks: PlacementTask[] = [];

    adjustedMappings.forEach(mapping => {
        const subject = allSubjects.find(s => s.id === mapping.subjectId);
        const isClubTask = (subject && (subject.name.toUpperCase().includes('KULÜP') || subject.branch.toUpperCase().includes('KULÜP'))) || mapping.id.startsWith('auto-kulup-');
        let hoursLeft = mapping.weeklyHours;

        const processTask = (block: number, index: string) => {
            // enforceDistributionPatterns aktifken 3 saatlik blokları BÖLME
            // Sadece kapalıyken böl (geriye uyumluluk için)
            if (!isClubTask && block === 3 && !globalRules?.enforceDistributionPatterns) {
                blockTasks.push({ mapping, blockLength: 2, taskId: `${mapping.id}-${index}-2`, isPlaced: false });
                singleHourTasks.push({ mapping, blockLength: 1, taskId: `${mapping.id}-${index}-1`, isPlaced: false });
                hoursLeft -= 3;
                return;
            }
            const task = { mapping, blockLength: block, taskId: `${mapping.id}-${index}`, isPlaced: false };

            if (isClubTask) clubTasks.push(task);
            else if (block > 1) blockTasks.push(task);
            else singleHourTasks.push(task);
            hoursLeft -= block;
        };

        const distribution = [...(mapping.distribution || [])];
        const patternTotal = distribution.reduce((a, b) => a + b, 0);

        // *** YENİ: Dağıtım Şekli Tam Uyumluluk ***
        if (globalRules?.enforceDistributionPatterns && distribution.length > 0 && patternTotal === mapping.weeklyHours) {
            // Pattern tam uyuyor - SADECE pattern'i kullan, başka ekleme yapma
            distribution.forEach((block, idx) => processTask(block, `dist-${idx}`));
        } else if (distribution.length > 0) {
            // Pattern var ama toplam uymuyor - pattern'i kullan, kalanı otomatik dağıt
            distribution.forEach((block, idx) => { if (hoursLeft >= block) processTask(block, `dist-${idx}`); });
            // Kalan saatler için optimal dağıtım
            let remIdx = 0;
            while (hoursLeft > 0) {
                if (hoursLeft >= 2) processTask(2, `rem-${remIdx++}`);
                else processTask(1, `rem-${remIdx++}`);
            }
        } else {
            // Pattern yok - haftalık saate göre optimal dağıtım oluştur
            // Örn: 5 saat → 2+2+1, 6 saat → 2+2+2, 8 saat → 2+2+2+2
            const optimalDistribution = generateOptimalDistribution(mapping.weeklyHours);
            optimalDistribution.forEach((block, idx) => processTask(block, `auto-${idx}`));
        }
    });

    const allGeneratedTasks = [...clubTasks, ...blockTasks, ...singleHourTasks];

    // *** YENİ: SABİT DERS YERLEŞTİRME ***
    // fixedSlots varsa, bu dersleri önce yerleştir
    if (fixedSlots && fixedSlots.length > 0) {


        // Önce tüm sabit slot kombinasyonlarını grupla (öğretmen-sınıf-ders)
        // Aynı kombinasyon için kaç sabit slot var say
        const fixedSlotCounts = new Map<string, { count: number; teacherId: string; classId: string; subjectId: string }>();
        fixedSlots.forEach(slot => {
            // Özel ayırıcı kullan çünkü ID'ler içinde '-' olabilir
            const key = `${slot.teacherId}|||${slot.classId}|||${slot.subjectId}`;
            const existing = fixedSlotCounts.get(key);
            if (existing) {
                existing.count++;
            } else {
                fixedSlotCounts.set(key, {
                    count: 1,
                    teacherId: slot.teacherId,
                    classId: slot.classId,
                    subjectId: slot.subjectId
                });
            }
        });



        // Her kombinasyon için gerekli sayıda task'ı işaretle
        fixedSlotCounts.forEach((info, _key) => {
            const { count: _count, teacherId, classId, subjectId } = info;
            const normalizedSubjectId = subjectId.toLowerCase().trim();



            // Bu kombinasyon için TÜM eşleşen task'ları bul
            const matchingTasks = allGeneratedTasks.filter(task => {
                if (task.mapping.teacherId !== teacherId) return false;
                if (task.mapping.classId !== classId) return false;

                const taskSubjectId = task.mapping.subjectId.toLowerCase().trim();
                const taskSubjectName = (task.mapping.subjectName || '').toLowerCase().trim();

                return taskSubjectId === normalizedSubjectId ||
                    taskSubjectId.includes(normalizedSubjectId) ||
                    normalizedSubjectId.includes(taskSubjectId) ||
                    taskSubjectName.includes('ade') && normalizedSubjectId.includes('ade');
            });



            // TÜM eşleşen task'ları isPlaced yap (sabit ders sayısına bakılmaksızın)
            matchingTasks.forEach(task => {
                if (!task.isPlaced) {
                    task.isPlaced = true;
                }
            });
        });

        // Şimdi sabit slotları grid'e yerleştir
        fixedSlots.forEach(slot => {
            // Sınıf Grid'de yoksa, oluştur!
            if (!classScheduleGrids[slot.classId]) {
                // console.warn(`⚠️ [SABİT-DERS] ${slot.classId} Grid'de yok, oluşturuluyor...`);
                classScheduleGrids[slot.classId] = {};
                classAvailability.set(slot.classId, new Set<string>());
                DAYS.forEach(day => { classScheduleGrids[slot.classId][day] = {}; });
            }

            const p = slot.period;
            const d = slot.day;

            if (!classScheduleGrids[slot.classId][d]) {
                classScheduleGrids[slot.classId][d] = {};
            }

            // Slot zaten dolu mu kontrol et (aynı sınıf için)
            const existingSlot = classScheduleGrids[slot.classId][d][p];
            if (existingSlot) return;

            // ÖNEMLİ: Aynı öğretmenin aynı slotta BAŞKA sınıfta dersi var mı?
            let fixedTeacherConflict = false;
            for (const otherClassId of Object.keys(classScheduleGrids)) {
                if (otherClassId === slot.classId) continue;
                const otherSlot = classScheduleGrids[otherClassId]?.[d]?.[p];
                if (otherSlot && otherSlot.teacherId === slot.teacherId) {
                    fixedTeacherConflict = true;
                    console.error(`🔴 [SABİT-DERS-ÇAKIŞMA] ${slot.teacherId} ${d}-${p}: ${otherClassId} zaten var, ${slot.classId} atlanıyor!`);
                    break;
                }
            }
            if (fixedTeacherConflict) return; // Bu sabit dersi atla - çakışma var!

            const teacherKey = `${d}-${p}`;

            classScheduleGrids[slot.classId][d][p] = {
                subjectId: slot.subjectId,
                teacherId: slot.teacherId,
                isFixed: true,
                isFixedSlot: true
            };

            // Öğretmen ve sınıf availability güncelle - Map'te yoksa önce ekle
            if (!teacherAvailability.has(slot.teacherId)) {
                teacherAvailability.set(slot.teacherId, new Set<string>());
            }
            teacherAvailability.get(slot.teacherId)!.add(teacherKey);
            if (!classAvailability.has(slot.classId)) {
                classAvailability.set(slot.classId, new Set<string>());
            }
            classAvailability.get(slot.classId)!.add(teacherKey);

            // Günlük saat sayaçlarını güncelle
            const dailyMap = teacherDailyTotalHours.get(slot.teacherId);
            if (dailyMap) dailyMap.set(d, (dailyMap.get(d) || 0) + 1);

            // Subject-Class-Day bloğu işaretle
            subjectClassDayBlocks.add(getSafeBlockKey(slot.subjectId, slot.classId, d));


        });
    }
    // *** SABİT DERS YERLEŞTİRME SONU ***

    // DEBUG: Sabit ders işleme sonrası kontrol
    if (fixedSlots && fixedSlots.length > 0) {

        // Sabit ders öğretmenlerinin availability durumunu göster
        const fixedTeachers = new Set(fixedSlots.map(s => s.teacherId));
        fixedTeachers.forEach(teacherId => {
            const slots = teacherAvailability.get(teacherId);
            if (slots) {

            } else {
                // console.warn(`⚠️ [SABİT-DERS] ${teacherId}: teacherAvailability'de YOK!`);
            }
        });
    }

    const checkAvailability = (m: SubjectTeacherMapping, day: string, p: string): { available: boolean; score: number } => {
        const getConstraint = (type: string, id: string) => {
            const keyBase = `${day}-${p}`;
            // 1. Direct match
            const raw = constraintMap.get(`${type}-${id}-${keyBase}`);
            if (raw) return raw;

            // 2. Normalized match
            const normKey = `${type}-${normalizeId(id, type as any)}-${keyBase}`;
            const norm = constraintMap.get(normKey);
            if (norm) return norm;

            // 3. O(1) Super-Clean match
            let scId = '';
            if (type === 'teacher') scId = teacherSCIds.get(id) || superClean(id);
            else if (type === 'class') scId = classSCIds.get(id) || superClean(id);
            else scId = superClean(id); // For subject, we don't use superCleanMap anymore for direct subject ID

            return superCleanMap.get(`${type}-${scId}-${keyBase}`);
        };

        const tConstraint = getConstraint('teacher', m.teacherId);
        const cConstraint = getConstraint('class', m.classId);
        const sConstraint = getConstraint('subject', m.subjectId);

        const subject = allSubjects.find(s => s.id === m.subjectId);
        const nameKey = subject ? slugify(subject.name) : '';
        const snConstraint = nameKey ? constraintMap.get(`subjectname-${nameKey}-${day}-${p}`) : undefined;

        if (tConstraint === 'unavailable' || cConstraint === 'unavailable' || sConstraint === 'unavailable' || snConstraint === 'unavailable') {
            return { available: false, score: 0 };
        }
        let score = 0;
        [tConstraint, cConstraint, sConstraint, snConstraint].forEach(c => { if (c === 'preferred') score += 2; if (c === 'restricted') score -= 1; });
        return { available: true, score };
    };

    const placeTasks = (tasks: PlacementTask[], allowedDays: string[], allowedPeriods: string[]) => {
        tasks.sort((a, b) => {
            const keyA = `${a.mapping.classId}-${a.mapping.teacherId}-${a.mapping.subjectId}-${a.blockLength}`;
            const keyB = `${b.mapping.classId}-${b.mapping.teacherId}-${b.mapping.subjectId}-${b.blockLength}`;
            const failsA = failureCounts?.get(keyA) || 0;
            const failsB = failureCounts?.get(keyB) || 0;
            const scoreA = (failsA * 1000) + (a.blockLength * 2000) + ((teacherLoad.get(a.mapping.teacherId) || 0) * 2) + (classLoad.get(a.mapping.classId) || 0);
            const scoreB = (failsB * 1000) + (b.blockLength * 2000) + ((teacherLoad.get(b.mapping.teacherId) || 0) * 2) + (classLoad.get(b.mapping.classId) || 0);
            if (scoreA !== scoreB) return scoreB - scoreA;
            return Math.random() - 0.5;
        });

        for (const task of tasks) {
            const classLevel = getSafeLevel(task.mapping.classId, task.mapping.teacherId);
            let placed = false;

            // *** YENİ: Otomatik Kulüp Dersleri İçin Özel Kısıtlar ***
            const isAutoClub = task.mapping.id.startsWith('auto-kulup-');
            const clubDay = 'Perşembe';
            const clubPeriods = classLevel === 'Ortaokul' ? ['7', '8'] : ['9', '10'];

            const daysToTry = isAutoClub ? [clubDay] : [...allowedDays].sort(() => Math.random() - 0.5);

            for (const day of daysToTry) {
                const scoredSlots: { startIndex: number, score: number }[] = [];

                // Kulüp için sadece belirli periyotları kontrol et
                const periodsToSearch = isAutoClub ? clubPeriods : allowedPeriods;

                // AKILLI DENGELEME: Günlük yükü ideal değere yakın tutmaya çalış
                const tid = task.mapping.teacherId;
                const currentDailyLoad = teacherDailyTotalHours.get(tid)?.get(day) || 0;
                const idealHigh = teacherIdealDailyHigh.get(tid) || 5;
                const idealLow = teacherIdealDailyLow.get(tid) || 4;

                // Kaç günü ideal'in üstünde doldurduk?
                let highDaysUsed = 0;
                DAYS.forEach(d => {
                    const load = teacherDailyTotalHours.get(tid)?.get(d) || 0;
                    if (load >= idealHigh) highDaysUsed++;
                });
                const highDaysAllowed = teacherHighDayCount.get(tid) || 0;

                // Dengeleme skoru hesapla
                let balancingScore = 0;
                const projectedLoad = currentDailyLoad + task.blockLength;

                if (projectedLoad <= idealLow) {
                    // İdeal'in altında - ÇOK İYİ (bu güne yerleştirmeyi teşvik et)
                    balancingScore = 30;
                } else if (projectedLoad <= idealHigh) {
                    // İdeal aralıkta - İYİ
                    if (highDaysUsed < highDaysAllowed) {
                        balancingScore = 20; // Henüz yüksek gün kotası dolmadı
                    } else {
                        balancingScore = 5;  // Kota doldu ama kabul edilebilir
                    }
                } else {
                    // İdeal'in üstünde - CEZA (bu günden kaçın)
                    balancingScore = -20;
                }

                // *** V13 FIX: GÜN BAZLI ERKEN SET KONTROLÜ ***
                // Eğer bu güne bu ders-sınıf için zaten blok varsa, O GÜNÜ TAMAMEN ATLA
                const dayBlockKey = getSafeBlockKey(task.mapping.subjectId, task.mapping.classId, day);
                if (subjectClassDayBlocks.has(dayBlockKey)) {
                    continue; // Bu günü atla, sonraki güne geç
                }

                for (let i = 0; i <= periodsToSearch.length - task.blockLength; i++) {
                    const consecutivePeriods = periodsToSearch.slice(i, i + task.blockLength);
                    let isAvailable = true;
                    let slotScore = balancingScore; // Start with balancing preference

                    const { teacherId, classId } = task.mapping;

                    // ÖNEMLİ KURAL: Öğretmenin günlük toplam saat limitini kontrol et
                    // < 28 saat haftalık yük → günlük maks 6
                    // >= 28 saat haftalık yük → günlük maks 7
                    const teacherWeeklyHours = teacherLoad.get(teacherId) || 0;
                    const teacherDailyLimit = teacherWeeklyHours >= 28 ? 8 : 7;
                    const totalDailyLoad = teacherDailyTotalHours.get(teacherId)?.get(day) || 0;
                    if (totalDailyLoad + task.blockLength > teacherDailyLimit) {
                        isAvailable = false;
                        continue; // Bu günde limit aşılacak, atla
                    }

                    if (!teacherClassDailyHours.get(teacherId)!.has(classId)) teacherClassDailyHours.get(teacherId)!.set(classId, new Map());

                    // *** ZORUNLU KURAL: Subject-Class-Day Bazlı Tek Blok ***
                    const blockKey = getSafeBlockKey(task.mapping.subjectId, classId, day);
                    if (subjectClassDayBlocks.has(blockKey)) {
                        isAvailable = false;
                        continue;
                    }

                    if (isAvailable) {
                        for (const p of consecutivePeriods) {
                            const key = `${day}-${p}`;
                            // ÖNEMLİ: ?. yerine güvenli kontrol - Map'te yoksa önce ekle
                            const teacherSet = teacherAvailability.get(task.mapping.teacherId);
                            const classSet = classAvailability.get(task.mapping.classId);

                            // DEBUG: Sabit ders öğretmenleri için kontrol
                            if (teacherSet && teacherSet.has(key)) {
                                // console.log(`🛑 [NORMAL-KONTROL] ${task.mapping.teacherId} ${key}: DOLU, atlanıyor`);
                            }

                            if ((teacherSet && teacherSet.has(key)) || (classSet && classSet.has(key))) { isAvailable = false; break; }

                            // Resource Collision Check
                            const resType = getResourceType(task.mapping);
                            if (resType) {
                                const key = `${day}-${p}-${resType}`;
                                const cap = resType === 'GYM' ? 2 : 1;
                                const occ = resourceAvailability.get(key) || [];
                                if (occ.length >= cap) { isAvailable = false; break; }
                            }

                            const { available, score } = checkAvailability(task.mapping, day, p);
                            if (!available) { isAvailable = false; break; }
                            slotScore += score;
                        }
                    }
                    if (isAvailable) scoredSlots.push({ startIndex: i, score: slotScore });
                }

                if (scoredSlots.length > 0) {
                    scoredSlots.sort((a, b) => b.score - a.score || Math.random() - 0.5);
                    const bestSlot = scoredSlots[0];
                    const periodsToSearch = isAutoClub ? clubPeriods : allowedPeriods;
                    const consecutivePeriods = periodsToSearch.slice(bestSlot.startIndex, bestSlot.startIndex + task.blockLength);

                    for (const p of consecutivePeriods) {
                        const key = `${day}-${p}`;

                        // ÖNEMLİ: Slot yazmadan önce TÜM SINIFLARDA bu öğretmenin bu slotta olup olmadığını kontrol et
                        let teacherConflict = false;
                        for (const otherClassId of Object.keys(classScheduleGrids)) {
                            if (otherClassId === task.mapping.classId) continue;
                            const otherSlot = classScheduleGrids[otherClassId]?.[day]?.[p];
                            if (otherSlot && otherSlot.teacherId === task.mapping.teacherId) {
                                teacherConflict = true;
                                break;
                            }
                        }
                        if (teacherConflict) {
                            // Bu period için çakışma var, bu task'ı atlayamayız çünkü consecutive blok
                            // Ama en azından üzerine yazma olmaz - loglayalım
                            // console.warn(`⚠️ [NORMAL-ÇAKIŞMA] ${task.mapping.teacherId} ${day}-${p}: Başka sınıfta zaten var, atlanıyor`);
                            continue; // Bu period'u atla
                        }

                        classScheduleGrids[task.mapping.classId][day][p] = { subjectId: task.mapping.subjectId, teacherId: task.mapping.teacherId, classId: task.mapping.classId, taskId: task.taskId };
                        teacherAvailability.get(task.mapping.teacherId)!.add(key);
                        classAvailability.get(task.mapping.classId)!.add(key);

                        // Mark Resource as used
                        const resType = getResourceType(task.mapping);
                        if (resType) {
                            const key = `${day}-${p}-${resType}`;
                            if (!resourceAvailability.has(key)) resourceAvailability.set(key, []);
                            resourceAvailability.get(key)!.push(task.taskId);
                        }
                    }

                    const { teacherId, classId } = task.mapping;
                    // Update Teacher Total Load
                    const dailyTotal = teacherDailyTotalHours.get(teacherId)!.get(day) || 0;
                    teacherDailyTotalHours.get(teacherId)!.set(day, dailyTotal + task.blockLength);

                    // Update Teacher-Class Daily Hours
                    const currentInClass = teacherClassDailyHours.get(teacherId)!.get(classId)!.get(day) || 0;
                    teacherClassDailyHours.get(teacherId)!.get(classId)!.set(day, currentInClass + task.blockLength);

                    // *** YENİ: Subject-Class-Day bloğu işaretle ***
                    subjectClassDayBlocks.add(getSafeBlockKey(task.mapping.subjectId, classId, day));

                    task.isPlaced = true;
                    placed = true;
                }
                if (placed) break;
            }
        }
    };

    const ilkokulKulupTasks = clubTasks.filter(t => {
        const level = getSafeLevel(t.mapping.classId, t.mapping.teacherId);
        return level === 'İlkokul' || level === 'Anaokulu';
    });

    const ortaokulKulupTasks = clubTasks.filter(t => getSafeLevel(t.mapping.classId, t.mapping.teacherId) === 'Ortaokul');
    placeTasks(ilkokulKulupTasks, ['Perşembe'], ['9', '10']);
    placeTasks(ortaokulKulupTasks, ['Perşembe'], ['7', '8']);
    const generalTasks = [...blockTasks, ...singleHourTasks].sort((a, b) => {
        const resA = getResourceType(a.mapping) ? 1 : 0;
        const resB = getResourceType(b.mapping) ? 1 : 0;
        if (resA !== resB) return resB - resA; // Prioritize Resource Tasks (IT, Gym)
        return b.blockLength - a.blockLength; // Then largest blocks first
    });
    placeTasks(generalTasks, DAYS, PERIODS);

    // OPTIMIZED V17: Balanced speed/quality (100→60 retries, early exit enabled)
    const maxRetries = 60;
    for (let retry = 0; retry < maxRetries; retry++) {
        const currentUnplaced = allGeneratedTasks.filter(t => !t.isPlaced);
        if (currentUnplaced.length === 0) break;
        let improvement = false;
        for (const taskA of currentUnplaced) {
            let solved = false;
            const daysToTry = [...DAYS].sort(() => Math.random() - 0.5);
            for (const day of daysToTry) {
                // *** V14 FIX: GÜN BAZLI ERKEN SET KONTROLÜ (RETRY) ***
                const retryDayKey = getSafeBlockKey(taskA.mapping.subjectId, taskA.mapping.classId, day);
                if (subjectClassDayBlocks.has(retryDayKey)) {
                    continue; // Bu güne zaten blok var, sonraki güne geç
                }

                const possibleStartIndices: number[] = [];
                for (let i = 0; i <= PERIODS.length - taskA.blockLength; i++) possibleStartIndices.push(i);
                possibleStartIndices.sort(() => Math.random() - 0.5);

                for (const startIndex of possibleStartIndices) {
                    const consecutive = PERIODS.slice(startIndex, startIndex + taskA.blockLength);
                    const conflictingTasks: PlacementTask[] = [];
                    let blocked = false;

                    for (const p of consecutive) {
                        const classConflict = classScheduleGrids[taskA.mapping.classId][day][p];
                        if (classConflict) {
                            if (classConflict.isFixed) { blocked = true; break; }
                            const tB = allGeneratedTasks.find(t => t.isPlaced && t.taskId === classConflict.taskId);
                            if (tB && !conflictingTasks.includes(tB)) conflictingTasks.push(tB);
                            else { blocked = true; break; }
                        }
                        const teacherSetA = teacherAvailability.get(taskA.mapping.teacherId);
                        if (teacherSetA && teacherSetA.has(`${day}-${p}`)) {
                            let foundSelfInOtherClass = false;
                            for (const otherClassId of selectedClassIds) {
                                if (otherClassId === taskA.mapping.classId) continue;
                                const otherSlot = classScheduleGrids[otherClassId][day][p];
                                if (otherSlot && otherSlot.teacherId === taskA.mapping.teacherId) {
                                    const tB = allGeneratedTasks.find(t => t.isPlaced && t.taskId === otherSlot.taskId);
                                    if (tB && !conflictingTasks.includes(tB)) { conflictingTasks.push(tB); foundSelfInOtherClass = true; break; }
                                }
                            }
                            if (!foundSelfInOtherClass) {
                                const classConflictInSelf = classScheduleGrids[taskA.mapping.classId][day][p];
                                if (!classConflictInSelf || classConflictInSelf.teacherId !== taskA.mapping.teacherId) { blocked = true; break; }
                            }
                        }
                        const resType = getResourceType(taskA.mapping);

                        if (resType) {
                            const key = `${day}-${p}-${resType}`;
                            const cap = resType === 'GYM' ? 2 : 1;
                            const occ = resourceAvailability.get(key) || [];
                            if (occ.length >= cap) {
                                // Capacity full, identifying conflicting tasks to remove
                                for (const occupantId of occ) {
                                    if (occupantId.startsWith('initial-')) { blocked = true; break; }
                                    const tB = allGeneratedTasks.find(t => t.isPlaced && t.taskId === occupantId);
                                    if (tB && !conflictingTasks.includes(tB)) conflictingTasks.push(tB);
                                }
                                if (conflictingTasks.length === 0 && !blocked) {
                                    // Should not happen if full, but safety check
                                    blocked = true;
                                }
                            }
                        }

                        if (!checkAvailability(taskA.mapping, day, p).available) { blocked = true; break; }
                    }

                    if (!blocked) {
                        const { teacherId, classId } = taskA.mapping;
                        let hoursToSubtractTotal = 0;
                        conflictingTasks.forEach(tB => {
                            if (tB.mapping.teacherId === teacherId) hoursToSubtractTotal += tB.blockLength;
                        });

                        // *** ZORUNLU KURAL: Subject-Class-Day Bazlı Tek Blok ***
                        const retryKey = getSafeBlockKey(taskA.mapping.subjectId, classId, day);

                        const conflictingHasThisKey = conflictingTasks.some(tB => {
                            return getSafeBlockKey(tB.mapping.subjectId, tB.mapping.classId, day) === retryKey;
                        });

                        if (subjectClassDayBlocks.has(retryKey) && !conflictingHasThisKey) {
                            blocked = true;
                        }

                        // ÖNEMLİ KURAL: Günlük toplam limit kontrolü (dinamik)
                        const teacherWeeklyHours = teacherLoad.get(teacherId) || 0;
                        const teacherDailyLimit = teacherWeeklyHours >= 28 ? 8 : 7;
                        const totalDailyLoad = teacherDailyTotalHours.get(teacherId)?.get(day) || 0;
                        if (totalDailyLoad - hoursToSubtractTotal + taskA.blockLength > teacherDailyLimit) blocked = true;
                    }

                    if (blocked || conflictingTasks.length === 0 || conflictingTasks.length > 3) continue;

                    const resTypeA = getResourceType(taskA.mapping);
                    const tempResKeys: string[] = [];

                    const originalSpots = new Map<string, { d: string, p: string }[]>();
                    for (const tB of conflictingTasks) {
                        const spots: { d: string, p: string }[] = [];
                        for (const d of DAYS) {
                            for (const pr of PERIODS) {
                                const slotToCheck = classScheduleGrids[tB.mapping.classId][d][pr];
                                // GÜVENLİK: Sabit dersler asla silinmez
                                if (slotToCheck?.taskId === tB.taskId && !slotToCheck.isFixed) {
                                    spots.push({ d, p: pr });
                                    classScheduleGrids[tB.mapping.classId][d][pr] = null;
                                    // Delete güvenli yapılmalı - Map'te varsa sil
                                    const tSetB = teacherAvailability.get(tB.mapping.teacherId);
                                    if (tSetB) tSetB.delete(`${d}-${pr}`);
                                    const cSetB = classAvailability.get(tB.mapping.classId);
                                    if (cSetB) cSetB.delete(`${d}-${pr}`);

                                    // Free Resource
                                    const resType = getResourceType(tB.mapping);
                                    if (resType) {
                                        const key = `${d}-${pr}-${resType}`;
                                        const occ = resourceAvailability.get(key) || [];
                                        resourceAvailability.set(key, occ.filter(id => id !== tB.taskId));
                                    }
                                }
                            }
                        }
                        originalSpots.set(tB.taskId, spots);
                        if (spots.length > 0) {
                            const d = spots[0].d;
                            const tId = tB.mapping.teacherId;
                            const cId = tB.mapping.classId;

                            const currentTotal = teacherDailyTotalHours.get(tId)!.get(d) || 0;
                            teacherDailyTotalHours.get(tId)!.set(d, Math.max(0, currentTotal - tB.blockLength));

                            const currentInClass = teacherClassDailyHours.get(tId)!.get(cId)!.get(d) || 0;
                            teacherClassDailyHours.get(tId)!.get(cId)!.set(d, Math.max(0, currentInClass - tB.blockLength));

                            // *** YENİ: Subject-Class-Day bloğunu sil (bump çıkarırken) ***
                            subjectClassDayBlocks.delete(getSafeBlockKey(tB.mapping.subjectId, cId, d));
                        }
                        tB.isPlaced = false;
                    }

                    // *** NOW block the resource for taskA AFTER its occupants are cleared ***
                    if (resTypeA) {
                        consecutive.forEach(p => {
                            const key = `${day}-${p}-${resTypeA}`;
                            if (!resourceAvailability.has(key)) resourceAvailability.set(key, []);
                            // For temp blocking during swap, we can just push a placeholder or the actual ID
                            // But strict blocking might be better? No, let's respect capacity.
                            // Actually, we are placing A here relative to OTHERS.
                            // So we should occupy one slot.
                            resourceAvailability.get(key)!.push(`temp-${taskA.taskId}`);
                            tempResKeys.push(key);
                        });
                    }

                    const newSpots = new Map<string, { d2: string, ps: string[] }>();
                    let allMoved = true;
                    for (const tB of conflictingTasks) {
                        const possibleB = [];
                        const daysB = [...DAYS].sort(() => Math.random() - 0.5);
                        for (const d2 of daysB) {
                            for (let s2 = 0; s2 <= PERIODS.length - tB.blockLength; s2++) {
                                const ps2 = PERIODS.slice(s2, s2 + tB.blockLength);
                                let ok = true;
                                for (const p2 of ps2) {
                                    const key2 = `${d2}-${p2}`;
                                    if (d2 === day && consecutive.includes(p2) && tB.mapping.classId === taskA.mapping.classId) { ok = false; break; }
                                    if (classScheduleGrids[tB.mapping.classId][d2][p2]) { ok = false; break; }
                                    const teacherSetB = teacherAvailability.get(tB.mapping.teacherId);
                                    const classSetB = classAvailability.get(tB.mapping.classId);
                                    if ((teacherSetB && teacherSetB.has(key2)) || (classSetB && classSetB.has(key2)) || !checkAvailability(tB.mapping, d2, p2).available) { ok = false; break; }

                                    // Resource check for moves
                                    const resType = getResourceType(tB.mapping);
                                    if (resType) {
                                        const key = `${d2}-${p2}-${resType}`;
                                        const cap = resType === 'GYM' ? 2 : 1;
                                        const occ = resourceAvailability.get(key) || [];
                                        if (occ.length >= cap) { ok = false; break; }
                                    }

                                    if (d2 === day && consecutive.includes(p2) && taskA.mapping.teacherId === tB.mapping.teacherId) { ok = false; break; }
                                }
                                if (ok) {
                                    if (getSafeLevel(tB.mapping.classId, tB.mapping.teacherId) === 'Ortaokul') {
                                        const currentH = teacherClassDailyHours.get(tB.mapping.teacherId)?.get(tB.mapping.classId)?.get(d2) || 0;
                                        if (currentH + tB.blockLength > Math.max(3, tB.blockLength)) ok = false;
                                    }

                                    // *** KRİTİK: Victim taşınırken de Subject-Class-Day kontrolü yap ***
                                    if (ok) {
                                        const mCheckKey = getSafeBlockKey(tB.mapping.subjectId, tB.mapping.classId, d2);
                                        // Eğer taşınacak güne zaten bir blok varsa (ve bu blok tB'nin kendisi değilse - ki zaten yerinden oynattık)
                                        if (subjectClassDayBlocks.has(mCheckKey)) ok = false;
                                    }
                                }
                                if (ok) possibleB.push({ d2, ps: ps2 });
                            }
                        }
                        if (possibleB.length > 0) {
                            const spot = possibleB[Math.floor(Math.random() * possibleB.length)];
                            newSpots.set(tB.taskId, spot);
                            for (const p of spot.ps) {
                                classScheduleGrids[tB.mapping.classId][spot.d2][p] = { taskId: tB.taskId };
                                teacherAvailability.get(tB.mapping.teacherId)!.add(`${spot.d2}-${p}`);
                                classAvailability.get(tB.mapping.classId)!.add(`${spot.d2}-${p}`);

                                // Mark Resource
                                const resType = getResourceType(tB.mapping);
                                if (resType) {
                                    const key = `${spot.d2}-${p}-${resType}`;
                                    if (!resourceAvailability.has(key)) resourceAvailability.set(key, []);
                                    resourceAvailability.get(key)!.push(tB.taskId);
                                }
                            }
                            if (getSafeLevel(tB.mapping.classId, tB.mapping.teacherId) === 'Ortaokul') {
                                if (!teacherClassDailyHours.get(tB.mapping.teacherId)!.has(tB.mapping.classId))
                                    teacherClassDailyHours.get(tB.mapping.teacherId)!.set(tB.mapping.classId, new Map());
                                const curr = teacherClassDailyHours.get(tB.mapping.teacherId)!.get(tB.mapping.classId)!.get(spot.d2) || 0;
                                teacherClassDailyHours.get(tB.mapping.teacherId)!.get(tB.mapping.classId)!.set(spot.d2, curr + tB.blockLength);
                            }
                            // *** YENİ: Subject-Class-Day bloğu işaretle ***
                            subjectClassDayBlocks.add(getSafeBlockKey(tB.mapping.subjectId, tB.mapping.classId, spot.d2));
                        } else { allMoved = false; break; }
                    }

                    // *** ALWAYS clear temp blocking before final placement ***
                    tempResKeys.forEach(k => {
                        const occ = resourceAvailability.get(k) || [];
                        resourceAvailability.set(k, occ.filter(id => id !== `temp-${taskA.taskId}`));
                    });

                    if (allMoved) {
                        // V12 FIX: Yerleştirme öncesi SET KONTROLÜ
                        const finalCheckKey = getSafeBlockKey(taskA.mapping.subjectId, taskA.mapping.classId, day);
                        // Çakışan task'lardan biri bu key'i serbest bırakacak mı?
                        const willBeFree = conflictingTasks.some(tB => {
                            // Çakışan task bump edildiğinde eski gününü kontrol et
                            const oldSpots = originalSpots.get(tB.taskId);
                            if (!oldSpots) return false;
                            // Çakışan task'ın orijinal günlerinden biri bu gün mü?
                            return oldSpots.some(sp => sp.d === day && getSafeBlockKey(tB.mapping.subjectId, tB.mapping.classId, sp.d) === finalCheckKey);
                        });

                        if (subjectClassDayBlocks.has(finalCheckKey) && !willBeFree) {
                            // Key zaten var ve serbest kalmayacak - yerleştirme iptal
                            allMoved = false;
                        }
                    }

                    if (allMoved) {
                        for (const tB of conflictingTasks) {
                            const spot = newSpots.get(tB.taskId)!;
                            for (const p of spot.ps) {
                                classScheduleGrids[tB.mapping.classId][spot.d2][p] = { subjectId: tB.mapping.subjectId, teacherId: tB.mapping.teacherId, classId: tB.mapping.classId, taskId: tB.taskId };
                            }
                            tB.isPlaced = true;
                        }
                        for (const p of consecutive) {
                            classScheduleGrids[taskA.mapping.classId][day][p] = { subjectId: taskA.mapping.subjectId, teacherId: taskA.mapping.teacherId, classId: taskA.mapping.classId, taskId: taskA.taskId };
                            teacherAvailability.get(taskA.mapping.teacherId)!.add(`${day}-${p}`);
                            classAvailability.get(taskA.mapping.classId)!.add(`${day}-${p}`);

                            // Mark Resource for taskA
                            const resType = getResourceType(taskA.mapping);
                            if (resType) {
                                const key = `${day}-${p}-${resType}`;
                                if (!resourceAvailability.has(key)) resourceAvailability.set(key, []);
                                resourceAvailability.get(key)!.push(taskA.taskId);
                            }
                        }
                        if (getSafeLevel(taskA.mapping.classId, taskA.mapping.teacherId) === 'Ortaokul') {
                            if (!teacherClassDailyHours.get(taskA.mapping.teacherId)!.has(taskA.mapping.classId)) teacherClassDailyHours.get(taskA.mapping.teacherId)!.set(taskA.mapping.classId, new Map());
                            const c = teacherClassDailyHours.get(taskA.mapping.teacherId)!.get(taskA.mapping.classId)!.get(day) || 0;
                            teacherClassDailyHours.get(taskA.mapping.teacherId)!.get(taskA.mapping.classId)!.set(day, c + taskA.blockLength);
                        }

                        // *** YENİ: Subject-Class-Day bloğu işaretle ***
                        subjectClassDayBlocks.add(getSafeBlockKey(taskA.mapping.subjectId, taskA.mapping.classId, day));

                        taskA.isPlaced = true;
                        solved = true;
                        improvement = true;
                        break;
                    } else {
                        for (const [tId, spot] of newSpots.entries()) {
                            const tB = conflictingTasks.find(t => t.taskId === tId)!;
                            for (const p of spot.ps) {
                                const slotToRemove = classScheduleGrids[tB.mapping.classId][spot.d2][p];
                                // GÜVENLİK: Sabit dersler asla silinmez
                                if (slotToRemove?.isFixed) continue;
                                classScheduleGrids[tB.mapping.classId][spot.d2][p] = null;
                                teacherAvailability.get(tB.mapping.teacherId)!.delete(`${spot.d2}-${p}`);
                                classAvailability.get(tB.mapping.classId)!.delete(`${spot.d2}-${p}`);

                                // Free Resource on rollback
                                const resType = getResourceType(tB.mapping);
                                if (resType) {
                                    const key = `${spot.d2}-${p}-${resType}`;
                                    const occ = resourceAvailability.get(key) || [];
                                    resourceAvailability.set(key, occ.filter(id => id !== tB.taskId));
                                }
                            }
                            if (getSafeLevel(tB.mapping.classId, tB.mapping.teacherId) === 'Ortaokul') {
                                // Update total daily
                                const currTotal = teacherDailyTotalHours.get(tB.mapping.teacherId)!.get(spot.d2) || 0;
                                teacherDailyTotalHours.get(tB.mapping.teacherId)!.set(spot.d2, Math.max(0, currTotal - tB.blockLength));

                                // Update class specific
                                const currInClass = teacherClassDailyHours.get(tB.mapping.teacherId)!.get(tB.mapping.classId)!.get(spot.d2) || 0;
                                teacherClassDailyHours.get(tB.mapping.teacherId)!.get(tB.mapping.classId)!.set(spot.d2, Math.max(0, currInClass - tB.blockLength));
                            }

                            // *** Rollback sırasında deneme amaçlı eklenen Set key'ini sil ***
                            subjectClassDayBlocks.delete(getSafeBlockKey(tB.mapping.subjectId, tB.mapping.classId, spot.d2));
                        }
                        for (const tB of conflictingTasks) {
                            const spots = originalSpots.get(tB.taskId)!;
                            for (const s of spots) {
                                classScheduleGrids[tB.mapping.classId][s.d][s.p] = { subjectId: tB.mapping.subjectId, teacherId: tB.mapping.teacherId, classId: tB.mapping.classId, taskId: tB.taskId };
                                teacherAvailability.get(tB.mapping.teacherId)!.add(`${s.d}-${s.p}`);
                                classAvailability.get(tB.mapping.classId)!.add(`${s.d}-${s.p}`);

                                // Re-mark Resource on rollback
                                const resType = getResourceType(tB.mapping);
                                if (resType) {
                                    const key = `${s.d}-${s.p}-${resType}`;
                                    if (!resourceAvailability.has(key)) resourceAvailability.set(key, []);
                                    resourceAvailability.get(key)!.push(tB.taskId);
                                }
                            }
                            if (spots.length > 0) {
                                const d = spots[0].d;
                                // *** Subject-Class-Day bloğu işaretle (rollback) ***
                                subjectClassDayBlocks.add(getSafeBlockKey(tB.mapping.subjectId, tB.mapping.classId, d));

                                if (getSafeLevel(tB.mapping.classId, tB.mapping.teacherId) === 'Ortaokul') {
                                    const curr = teacherClassDailyHours.get(tB.mapping.teacherId)!.get(tB.mapping.classId)!.get(d) || 0;
                                    teacherClassDailyHours.get(tB.mapping.teacherId)!.get(tB.mapping.classId)!.set(d, curr + tB.blockLength);
                                }
                            }
                            tB.isPlaced = true;
                        }
                    }
                }
                if (solved) break;
            }

            if (!solved && retry < 30) {
                const daysToBump = [...DAYS].sort(() => Math.random() - 0.5);
                for (const day of daysToBump) {
                    // *** V14 FIX: GÜN BAZLI ERKEN SET KONTROLÜ (VICTIM KICKING) ***
                    const kickDayKey = getSafeBlockKey(taskA.mapping.subjectId, taskA.mapping.classId, day);
                    if (subjectClassDayBlocks.has(kickDayKey)) {
                        continue; // Bu güne zaten blok var, sonraki güne geç
                    }

                    const possibleIndices: number[] = [];
                    for (let i = 0; i <= PERIODS.length - taskA.blockLength; i++) possibleIndices.push(i);
                    possibleIndices.sort(() => Math.random() - 0.5);
                    for (const startIndex of possibleIndices) {
                        const consecutive = PERIODS.slice(startIndex, startIndex + taskA.blockLength);
                        let physicallyPossible = true;
                        const occupantsToKick: PlacementTask[] = [];
                        for (const p of consecutive) {
                            if (!checkAvailability(taskA.mapping, day, p).available) { physicallyPossible = false; break; }
                            const teacherSetA2 = teacherAvailability.get(taskA.mapping.teacherId);
                            if (teacherSetA2 && teacherSetA2.has(`${day}-${p}`)) {
                                for (const otherC of selectedClassIds) {
                                    if (otherC === taskA.mapping.classId) continue;
                                    const slot = classScheduleGrids[otherC][day][p];
                                    if (slot && slot.teacherId === taskA.mapping.teacherId) {
                                        const tExisting = allGeneratedTasks.find(t => t.isPlaced && t.taskId === slot.taskId);
                                        if (tExisting && !occupantsToKick.includes(tExisting)) occupantsToKick.push(tExisting);
                                    }
                                }
                            }
                            const existing = classScheduleGrids[taskA.mapping.classId][day][p];
                            if (existing) {
                                if (existing.isFixed) { physicallyPossible = false; break; }
                                const tExisting = allGeneratedTasks.find(t => t.isPlaced && t.taskId === existing.taskId);
                                if (tExisting && !occupantsToKick.includes(tExisting)) occupantsToKick.push(tExisting);
                            }

                            // Resource Collision in Bump logic
                            const resType = getResourceType(taskA.mapping);
                            if (resType) {
                                const key = `${day}-${p}-${resType}`;
                                const cap = resType === 'GYM' ? 2 : 1;
                                const occ = resourceAvailability.get(key) || [];
                                if (occ.length >= cap) {
                                    // Must kick someone
                                    for (const occupantId of occ) {
                                        if (occupantId.startsWith('initial-')) { physicallyPossible = false; break; }
                                        const tExisting = allGeneratedTasks.find(t => t.isPlaced && t.taskId === occupantId);
                                        if (tExisting && !occupantsToKick.includes(tExisting)) occupantsToKick.push(tExisting);
                                    }
                                }
                                // If not full, we don't need to kick resource occupants!
                            }
                        }
                        if (physicallyPossible) {
                            const { teacherId, classId } = taskA.mapping;
                            let hoursFreedTotal = 0;
                            occupantsToKick.forEach(ok => {
                                if (ok.mapping.teacherId === teacherId) hoursFreedTotal += ok.blockLength;
                            });

                            // *** ZORUNLU KURAL: Subject-Class-Day Bazlı Tek Blok (ek retry kontrolü) ***
                            const checkKey = getSafeBlockKey(taskA.mapping.subjectId, classId, day);
                            const willFreeThisKey = occupantsToKick.some(ok => {
                                return getSafeBlockKey(ok.mapping.subjectId, ok.mapping.classId, day) === checkKey;
                            });
                            if (subjectClassDayBlocks.has(checkKey) && !willFreeThisKey) {
                                physicallyPossible = false;
                            }

                            // ÖNEMLİ KURAL: Günlük toplam limit kontrolü (dinamik)
                            const teacherWeeklyHours = teacherLoad.get(teacherId) || 0;
                            const teacherDailyLimit = teacherWeeklyHours >= 28 ? 8 : 7;
                            const totalDailyLoad = teacherDailyTotalHours.get(teacherId)?.get(day) || 0;
                            if (totalDailyLoad - hoursFreedTotal + taskA.blockLength > teacherDailyLimit) physicallyPossible = false;
                        }
                        if (physicallyPossible) {
                            // V12 FIX: Yerleştirme öncesi SET KONTROLÜ
                            const finalKickKey = getSafeBlockKey(taskA.mapping.subjectId, taskA.mapping.classId, day);
                            // Victim'lardan biri bu key'i serbest bırakacak mı?
                            const willBeFreedByKick = occupantsToKick.some(victim => {
                                return getSafeBlockKey(victim.mapping.subjectId, victim.mapping.classId, day) === finalKickKey;
                            });

                            if (subjectClassDayBlocks.has(finalKickKey) && !willBeFreedByKick) {
                                // Key zaten var ve victim'lar serbest bırakmayacak - yerleştirme iptal
                                physicallyPossible = false;
                            }
                        }
                        if (physicallyPossible) {
                            for (const victim of occupantsToKick) {
                                victim.isPlaced = false;
                                const cId = victim.mapping.classId;
                                const tId = victim.mapping.teacherId;
                                for (const dScan of DAYS) {
                                    for (const pScan of PERIODS) {
                                        const slotToCheck = classScheduleGrids[cId][dScan][pScan];
                                        // GÜVENLİK: Sabit dersler asla silinmez
                                        if (slotToCheck?.taskId === victim.taskId && !slotToCheck.isFixed) {
                                            classScheduleGrids[cId][dScan][pScan] = null;
                                            // Delete güvenli yapılmalı
                                            const tSetV = teacherAvailability.get(tId);
                                            if (tSetV) tSetV.delete(`${dScan}-${pScan}`);
                                            const cSetV = classAvailability.get(cId);
                                            if (cSetV) cSetV.delete(`${dScan}-${pScan}`);

                                            // Free Resource for victim
                                            const resType = getResourceType(victim.mapping);
                                            if (resType) {
                                                const key = `${dScan}-${pScan}-${resType}`;
                                                const occ = resourceAvailability.get(key) || [];
                                                resourceAvailability.set(key, occ.filter(id => id !== victim.taskId));
                                            }

                                            // *** KRİTİK: Victim'in bulunduğu GÜN (dScan) için temizlik yap ***
                                            if (getSafeLevel(cId, tId) === 'Ortaokul') {
                                                const curr = teacherClassDailyHours.get(tId)?.get(cId)?.get(dScan) || 0;
                                                teacherClassDailyHours.get(tId)?.get(cId)?.set(dScan, Math.max(0, curr - victim.blockLength));
                                            }
                                            // *** Subject-Class-Day bloğunu sil (victim) - DOĞRU GÜN (dScan) ***
                                            subjectClassDayBlocks.delete(getSafeBlockKey(victim.mapping.subjectId, cId, dScan));
                                        }
                                    }
                                }
                            }
                            for (const p of consecutive) {
                                classScheduleGrids[taskA.mapping.classId][day][p] = { subjectId: taskA.mapping.subjectId, teacherId: taskA.mapping.teacherId, classId: taskA.mapping.classId, taskId: taskA.taskId };
                                teacherAvailability.get(taskA.mapping.teacherId)!.add(`${day}-${p}`);
                                classAvailability.get(taskA.mapping.classId)!.add(`${day}-${p}`);

                                // Mark Resource for taskA
                                const resType = getResourceType(taskA.mapping);
                                if (resType) {
                                    const key = `${day}-${p}-${resType}`;
                                    if (!resourceAvailability.has(key)) resourceAvailability.set(key, []);
                                    resourceAvailability.get(key)!.push(taskA.taskId);
                                }
                            }

                            const { teacherId, classId } = taskA.mapping;
                            // Update total daily
                            const dailyTotal = teacherDailyTotalHours.get(teacherId)!.get(day) || 0;
                            teacherDailyTotalHours.get(teacherId)!.set(day, dailyTotal + taskA.blockLength);

                            // Update class specific
                            if (!teacherClassDailyHours.get(teacherId)!.has(classId)) teacherClassDailyHours.get(teacherId)!.set(classId, new Map());
                            const hoursInClass = teacherClassDailyHours.get(teacherId)!.get(classId)!.get(day) || 0;
                            teacherClassDailyHours.get(teacherId)!.get(classId)!.set(day, hoursInClass + taskA.blockLength);

                            // *** Subject-Class-Day bloğu işaretle (ek retry) ***
                            subjectClassDayBlocks.add(getSafeBlockKey(taskA.mapping.subjectId, taskA.mapping.classId, day));

                            taskA.isPlaced = true;
                            solved = true;
                            improvement = true;
                            break;
                        }
                    }
                    if (solved) break;
                }
            }
        }
        if (!improvement) break;
    }

    // *** ESNEK YERLEŞTİRME SİSTEMİ ***
    // %95+ yerleştirilmişse, kalan dersler için esnek mod aktif
    const totalToPlace = allGeneratedTasks.reduce((sum, t) => {
        if (t.mapping.id.startsWith('auto-kulup-teacher-')) return sum;
        return sum + t.blockLength;
    }, 0);

    let tempPlaced = 0;
    allGeneratedTasks.forEach(t => {
        if (t.isPlaced && !t.mapping.id.startsWith('auto-kulup-teacher-'))
            tempPlaced += t.blockLength;
    });

    const placementRatio = totalToPlace > 0 ? tempPlaced / totalToPlace : 1;

    // console.log(`[ESNEK] Yerleşim oranı: ${(placementRatio * 100).toFixed(1)}% (${tempPlaced}/${totalToPlace}), Eşik: ${FLEXIBLE_PLACEMENT_THRESHOLD * 100}%`);

    // *** ŞART 2: Korumalı derslerin (Görsel Sanatlar, Bilişim, Beden Eğitimi, Müzik) blok olarak atanmış olması ***
    const protectedSubjectTasks = allGeneratedTasks.filter(t => {
        if (t.mapping.id.startsWith('auto-kulup-teacher-')) return false;
        const subjectName = (t.mapping.subjectName || t.mapping.subjectId || '').toLowerCase();
        return isProtectedSubject(subjectName);
    });

    const allProtectedSubjectsPlaced = protectedSubjectTasks.length === 0 ||
        protectedSubjectTasks.every(t => t.isPlaced);

    // console.log(`[ESNEK] Korumalı ders sayısı: ${protectedSubjectTasks.length}, Tamamı yerleşti mi: ${allProtectedSubjectsPlaced}`);

    // *** ESNEK YERLEŞTİRME: Sadece boş slotlara günde tek saat yerleştirme ***
    // ŞART 1: Yerleşim oranı >= %95
    // ŞART 2: Korumalı dersler (Görsel Sanatlar, Bilişim, Beden Eğitimi, Müzik) blok olarak atanmış olmalı
    if (placementRatio >= FLEXIBLE_PLACEMENT_THRESHOLD && placementRatio < 1 && allProtectedSubjectsPlaced) {
        // console.log('[ESNEK] ✅ Esnek mod AKTİF - kalan dersler tekli yerleştirilecek');

        // Esnek mod aktif - kalan dersleri tekli yerleştirmeye çalış
        const remainingTasks = allGeneratedTasks.filter(t =>
            !t.isPlaced && !t.mapping.id.startsWith('auto-kulup-teacher-')
        );

        // console.log(`[ESNEK] Kalan görev sayısı: ${remainingTasks.length}`);

        for (const task of remainingTasks) {
            if (task.isPlaced) continue;

            const classId = task.mapping.classId;
            const teacherId = task.mapping.teacherId;
            const subjectId = task.mapping.subjectId;

            const _teacherName = (task.mapping as any).teacherName || teacherId;
            const _className = (task.mapping as any).className || classId;
            const _subjectName = task.mapping.subjectName || subjectId;

            // console.log(`[ESNEK] İşleniyor: ${teacherName} → ${className} → ${subjectName} (${task.blockLength} saat)`);

            // Her saat için ayrı ayrı yerleştirmeyi dene
            let hoursPlaced = 0;
            const hoursNeeded = task.blockLength;

            for (const day of DAYS) {
                if (hoursPlaced >= hoursNeeded) break;

                // NOT: Esnek modda subjectClassDayBlocks kontrolü YAPILMIYOR
                // Çünkü tüm saat yerleştirilmesi, dağıtım şeklinden daha önemli
                // Aynı güne ikinci saat yerleştirilebilir
                const dayBlockKey = getSafeBlockKey(subjectId, classId, day);

                // Bu güne bu ders için kaç saat var?
                let hoursThisDay = 0;
                for (const p of PERIODS) {
                    const slot = classScheduleGrids[classId]?.[day]?.[p];
                    if (slot && slot.subjectId === subjectId) hoursThisDay++;
                }
                // Günde MAX 2 saat (dağıtım şeklini fazla bozmamak için)
                if (hoursThisDay >= 2) continue;

                // Bu güne sadece 1 saat daha yerleştir
                let placedThisDay = false;

                for (const period of PERIODS) {
                    if (hoursPlaced >= hoursNeeded) break;
                    if (placedThisDay) break; // Bu güne zaten yerleştirdik

                    // Slot boş mu?
                    if (classScheduleGrids[classId]?.[day]?.[period]) continue;

                    // Öğretmen müsait mi?
                    const teacherKey = `${day}-${period}`;
                    // ÖNEMLİ: Öğretmen Map'te yoksa ekle
                    if (!teacherAvailability.has(teacherId)) {
                        teacherAvailability.set(teacherId, new Set<string>());
                    }
                    if (teacherAvailability.get(teacherId)!.has(teacherKey)) continue;

                    // Sınıf müsait mi?
                    if (!classAvailability.has(classId)) {
                        classAvailability.set(classId, new Set<string>());
                    }
                    if (classAvailability.get(classId)!.has(teacherKey)) continue;

                    // Kısıtlamalar uygun mu?
                    const availability = checkAvailability(task.mapping, day, period);
                    if (!availability.available) continue;

                    // ÖNEMLİ: Slot yazmadan önce TÜM SINIFLARDA bu öğretmenin bu slotta olup olmadığını kontrol et
                    let teacherConflictFlex = false;
                    for (const otherClassId of Object.keys(classScheduleGrids)) {
                        if (otherClassId === classId) continue;
                        const otherSlot = classScheduleGrids[otherClassId]?.[day]?.[period];
                        if (otherSlot && otherSlot.teacherId === teacherId) {
                            teacherConflictFlex = true;
                            break;
                        }
                    }
                    if (teacherConflictFlex) {
                        // console.warn(`⚠️ [ESNEK-ÇAKIŞMA-ATLA] ${teacherId} ${day}-${period}: Başka sınıfta zaten var, atlanıyor`);
                        continue;
                    }

                    // YERLEŞTİR (tekli - günde sadece 1)
                    classScheduleGrids[classId][day][period] = {
                        subjectId: subjectId,
                        teacherId: teacherId,
                        taskId: task.taskId + `-flex-${hoursPlaced}`
                    };

                    teacherAvailability.get(teacherId)!.add(teacherKey);
                    classAvailability.get(classId)!.add(teacherKey);

                    // Günde tek blok kuralını işaretle
                    subjectClassDayBlocks.add(dayBlockKey);

                    const dailyMap = teacherDailyTotalHours.get(teacherId);
                    if (dailyMap) dailyMap.set(day, (dailyMap.get(day) || 0) + 1);

                    hoursPlaced++;
                    placedThisDay = true; // Bu güne yerleştirdik, diğer güne geç
                }
            }
            // *** DERS TAŞIMA: Boş slot yoksa, taşınabilir ders ara ***
            if (hoursPlaced < hoursNeeded) {
                for (const day of DAYS) {
                    if (hoursPlaced >= hoursNeeded) break;

                    // Bu güne bu ders için kaç saat var?
                    let hoursThisDay = 0;
                    for (const p of PERIODS) {
                        const slot = classScheduleGrids[classId]?.[day]?.[p];
                        if (slot && slot.subjectId === subjectId) hoursThisDay++;
                    }
                    // Günde MAX 2 saat (dağıtım şeklini fazla bozmamak için)
                    if (hoursThisDay >= 2) continue;

                    const newLessonDayKey = getSafeBlockKey(subjectId, classId, day);

                    for (const period of PERIODS) {
                        if (hoursPlaced >= hoursNeeded) break;

                        const existingSlot = classScheduleGrids[classId]?.[day]?.[period];
                        if (!existingSlot) continue;
                        if (existingSlot.isFixed || existingSlot.isFixedSlot) continue;

                        // Korumalı ders mi?
                        const existingSubject = allSubjects.find(s => s.id === existingSlot.subjectId);
                        const existingSubjectName = existingSubject?.name || '';
                        if (isProtectedSubject(existingSubjectName)) continue;

                        // *** GÜVENLİK KONTROLÜ: Bu dersin o günde kaç slotu var? ***
                        // 3+ slotlu blokları taşıma (çok büyük), ama 1-2 slotlu olabilir
                        let existingLessonSlotsThisDay = 0;
                        for (const p of PERIODS) {
                            const slot = classScheduleGrids[classId]?.[day]?.[p];
                            if (slot && slot.subjectId === existingSlot.subjectId &&
                                slot.teacherId === existingSlot.teacherId) {
                                existingLessonSlotsThisDay++;
                            }
                        }
                        // 1-2 slotlu dersler taşınabilir, 3+ slot taşınamaz
                        if (existingLessonSlotsThisDay > 2) {
                            continue;
                        }

                        const existingTeacherId = existingSlot.teacherId;
                        let foundNewSlot = false;

                        // Mevcut dersi taşıyabileceğimiz boş gün ara
                        for (const newDay of DAYS) {
                            if (foundNewSlot) break;
                            if (newDay === day) continue; // Aynı güne taşıma

                            // Taşınacak ders için yeni günde zaten blok VAR MI kontrol et
                            const existingLessonNewDayKey = getSafeBlockKey(existingSlot.subjectId, classId, newDay);
                            if (subjectClassDayBlocks.has(existingLessonNewDayKey)) continue;

                            for (const newPeriod of PERIODS) {
                                if (foundNewSlot) break;

                                const newKey = `${newDay}-${newPeriod}`;

                                // ÖNEMLİ: Map'te yoksa önce ekle, sonra kontrol et
                                if (!teacherAvailability.has(existingTeacherId)) {
                                    teacherAvailability.set(existingTeacherId, new Set<string>());
                                }
                                if (teacherAvailability.get(existingTeacherId)!.has(newKey)) continue;

                                if (!classAvailability.has(classId)) {
                                    classAvailability.set(classId, new Set<string>());
                                }
                                if (classAvailability.get(classId)!.has(newKey)) continue;

                                if (classScheduleGrids[classId]?.[newDay]?.[newPeriod]) continue;

                                // ÖNEMLİ: Mevcut dersin öğretmeni (existingTeacherId) yeni slotta BAŞKA sınıfta var mı?
                                let existingTeacherConflict = false;
                                for (const otherClassId of Object.keys(classScheduleGrids)) {
                                    if (otherClassId === classId) continue;
                                    const otherSlot = classScheduleGrids[otherClassId]?.[newDay]?.[newPeriod];
                                    if (otherSlot && otherSlot.teacherId === existingTeacherId) {
                                        existingTeacherConflict = true;
                                        break;
                                    }
                                }
                                if (existingTeacherConflict) continue; // Mevcut ders buraya taşınamaz

                                // === TAŞIMA İŞLEMİ ===
                                // 1. ESKİ dersi yeni yere taşı
                                classScheduleGrids[classId][newDay][newPeriod] = { ...existingSlot };
                                teacherAvailability.get(existingTeacherId)!.delete(`${day}-${period}`);
                                teacherAvailability.get(existingTeacherId)!.add(newKey);
                                classAvailability.get(classId)!.delete(`${day}-${period}`);
                                classAvailability.get(classId)!.add(newKey);

                                // Taşınan dersin gün bloğunu güncelle
                                const oldExistingKey = getSafeBlockKey(existingSlot.subjectId, classId, day);
                                subjectClassDayBlocks.delete(oldExistingKey);
                                subjectClassDayBlocks.add(existingLessonNewDayKey);

                                // ÖNEMLİ: Yeni ders yerleştirmeden önce çakışma kontrolü
                                let moveConflict = false;
                                for (const otherClassId of Object.keys(classScheduleGrids)) {
                                    if (otherClassId === classId) continue;
                                    const otherSlot = classScheduleGrids[otherClassId]?.[day]?.[period];
                                    if (otherSlot && otherSlot.teacherId === teacherId) {
                                        moveConflict = true;
                                        break;
                                    }
                                }
                                if (moveConflict) {
                                    // Taşıma işlemi geri al - mevcut dersi eski yerine koy
                                    classScheduleGrids[classId][day][period] = { ...existingSlot };
                                    classScheduleGrids[classId][newDay][newPeriod] = null;
                                    teacherAvailability.get(existingTeacherId)!.delete(newKey);
                                    teacherAvailability.get(existingTeacherId)!.add(`${day}-${period}`);
                                    classAvailability.get(classId)!.delete(newKey);
                                    classAvailability.get(classId)!.add(`${day}-${period}`);
                                    subjectClassDayBlocks.delete(existingLessonNewDayKey);
                                    subjectClassDayBlocks.add(oldExistingKey);
                                    continue; // Bu taşıma işlemini iptal et
                                }

                                // 2. YENİ dersi eski yere yerleştir
                                classScheduleGrids[classId][day][period] = {
                                    subjectId: subjectId,
                                    teacherId: teacherId,
                                    taskId: task.taskId + `-flex-${hoursPlaced}`
                                };
                                // ÖNEMLİ: Öğretmen Map'te yoksa ekle
                                if (!teacherAvailability.has(teacherId)) {
                                    teacherAvailability.set(teacherId, new Set<string>());
                                }
                                teacherAvailability.get(teacherId)!.add(`${day}-${period}`);
                                subjectClassDayBlocks.add(newLessonDayKey);

                                const dailyMap = teacherDailyTotalHours.get(teacherId);
                                if (dailyMap) dailyMap.set(day, (dailyMap.get(day) || 0) + 1);

                                hoursPlaced++;
                                foundNewSlot = true;
                                // console.log(`[ESNEK-TAŞIMA] ${existingSubjectName} → ${newDay} taşındı, ${subjectName} → ${day} yerleştirildi`);
                            }
                        }
                        if (foundNewSlot) break; // Bu günden çık, sonraki güne geç
                    }
                }
            }

            if (hoursPlaced >= hoursNeeded) {
                task.isPlaced = true;
                // console.log(`[ESNEK] ✅ YERLEŞTİRİLDİ: ${teacherName} → ${className} → ${subjectName} (${hoursPlaced}/${hoursNeeded} saat)`);
            } else if (hoursPlaced > 0) {
                // console.warn(`🔴 [ESNEK-KISMİ] ${task.mapping.subjectId} → ${task.mapping.classId}: ${hoursPlaced}/${hoursNeeded} saat`);
            } else {
                // console.warn(`🔴 [ESNEK-BAŞARISIZ] ${task.mapping.subjectId} → ${task.mapping.classId}: 0/${hoursNeeded} saat`);
            }
        }
    }
    // *** ESNEK YERLEŞTİRME SONU ***

    let currentPlacedBalance = 0;
    allGeneratedTasks.forEach(t => { if (t.isPlaced && !t.mapping.id.startsWith('auto-kulup-teacher-')) currentPlacedBalance += t.blockLength; });

    // Sabit dersleri de placed sayısına ekle - AMA sadece normal (kulüp olmayan) dersler varsa
    // Kulüp ataması sırasında (sadece auto-subject-kulup mappingler varsa) sabit dersleri sayma
    const hasNonClubMappings = adjustedMappings.some(m => m.subjectId !== 'auto-subject-kulup');
    if (hasNonClubMappings) {
        const fixedSlotsCount = fixedSlots?.length || 0;
        currentPlacedBalance += fixedSlotsCount;
    }

    // *** DEBUG: Generation sonrası çakışma tespiti ***
    const teacherSlotDebug: Record<string, { classId: string; day: string; period: string }[]> = {};
    Object.entries(classScheduleGrids).forEach(([classId, days]) => {
        Object.entries(days as any).forEach(([day, periods]) => {
            Object.entries(periods as any).forEach(([period, slot]: [string, any]) => {
                if (slot && slot.teacherId) {
                    const key = `${slot.teacherId}-${day}-${period}`;
                    if (!teacherSlotDebug[key]) teacherSlotDebug[key] = [];
                    teacherSlotDebug[key].push({ classId, day, period });
                }
            });
        });
    });

    let conflictCount = 0;
    Object.entries(teacherSlotDebug).forEach(([key, slots]) => {
        if (slots.length > 1) {
            conflictCount++;
            console.error(`🔴 [GENERATION-ÇAKIŞMA] ${key}: ${slots.map(s => s.classId).join(' vs ')}`);
        }
    });
    if (conflictCount > 0) {
        console.error(`📊 [GENERATION-ÇAKIŞMA-ÖZET] Toplam ${conflictCount} çakışma tespit edildi!`);
    } else {

    }

    return { grid: classScheduleGrids, tasks: allGeneratedTasks, placedCount: currentPlacedBalance, conflictCount };
};

export async function generateSystematicSchedule(
    mappings: SubjectTeacherMapping[],
    _allTeachers: Teacher[],
    allClasses: Class[],
    allSubjects: Subject[],
    timeConstraints: TimeConstraint[],
    _globalRules: WizardData['constraints']['globalRules'],
    stopRef: React.MutableRefObject<boolean>,
    onProgress?: (progress: number) => void,
    initialSchedules?: { teacherId: string, schedule: Schedule['schedule'] }[],
    fixedSlots?: FixedSlot[]  // YENİ: Sabit ders yerleştirme
): Promise<EnhancedGenerationResult> {
    const superClean = ultraClean;
    const totalLessonsToPlace = mappings
        .filter(m => !m.id.startsWith('auto-kulup-teacher-'))
        .reduce((sum, m) => sum + m.weeklyHours, 0);
    // OPTIMIZED V18: Agresif hız optimizasyonu - minimum deneme sayısı ile başla
    // Yetersiz kalırsa değer yükseltilebilir (150→200→300)
    const MAX_ATTEMPTS = _globalRules?.enforceDistributionPatterns ? 150 : 100;
    let attempt = 0;
    // Initialize bestResult with initialSchedules if provided
    let bestResult: { schedules: any[], placedLessons: number, unassignedTasks: PlacementTask[], grid?: { [classId: string]: any }, conflictCount?: number } = {
        schedules: initialSchedules ? initialSchedules.map(s => ({ ...s, updatedAt: new Date() })) : [],
        placedLessons: -1,
        unassignedTasks: [],
        grid: undefined,
        conflictCount: undefined
    };
    const globalFailureCounts = new Map<string, number>();

    // INFRASTRUCTURE: Standardize all constraint IDs to ensure backward compatibility and strict matching
    const normalizedConstraints = timeConstraints.map(c => ({
        ...c,
        entityId: normalizeId(c.entityId, c.entityType as any)
    }));

    // ... (Log diagnostics omitted for brevity, they remain) ...

    // --- RESOURCE CACHE PRE-CALCULATION ---
    const resourceTypeCache = new Map<string, string | null>();
    const getResourceTypeGlobal = (subjectId: string, teacherId?: string): string | null => {
        const cacheKey = `${subjectId}-${teacherId || 'no-teacher'}`;
        if (resourceTypeCache.has(cacheKey)) return resourceTypeCache.get(cacheKey)!;

        // Normalization for robust matching
        const sItem = allSubjects.find(s => s.id === subjectId || normalizeId(s.id, 'subject') === normalizeId(subjectId, 'subject'));
        const teacher = teacherId ? _allTeachers.find(t => t.id === teacherId || normalizeId(t.id, 'teacher') === normalizeId(teacherId, 'teacher')) : null;

        const checkKeywords = (text: string): string | null => {
            if (!text) return null;
            const clean = ultraClean(text);
            if (clean.includes('bilisim') || clean.includes('teknoloji') || clean.includes('bilgisayar')) return 'IT_ROOM';
            if (clean.includes('beden') || clean.includes('spor') || clean.includes('gym')) return 'GYM';
            return null;
        };

        let result: string | null = null;

        // 1. Primary Check: Subject Name or Branch
        if (sItem) {
            result = checkKeywords(sItem.name) || checkKeywords(sItem.branch);
        }

        // 2. Secondary Check: Subject ID Keywords
        if (!result) {
            result = checkKeywords(subjectId);
        }

        if (!result && teacher) {
            const tBranch = ultraClean(teacher.branch || '');
            if (tBranch.includes('bilisim') || tBranch.includes('teknoloji') || tBranch.includes('bilgisayar')) result = 'IT_ROOM';
            else if (tBranch.includes('beden') || tBranch.includes('spor') || tBranch.includes('gym')) result = 'GYM';
        }

        resourceTypeCache.set(cacheKey, result);
        return result;
    };

    // Pre-populate for all relevant combinations
    mappings.forEach(m => getResourceTypeGlobal(m.subjectId, m.teacherId));
    if (initialSchedules) {
        initialSchedules.forEach(s => {
            Object.values(s.schedule).forEach(day => {
                Object.values(day).forEach(slot => {
                    if (slot?.subjectId) getResourceTypeGlobal(slot.subjectId, s.teacherId);
                });
            });
        });
    }

    while (bestResult.placedLessons < totalLessonsToPlace && attempt < MAX_ATTEMPTS && !stopRef.current) {
        attempt++;
        // OPTIMIZED: Smooth progress bar with browser yield to prevent freezing
        // Update every 6 attempts (~1% increments) and yield to keep UI responsive
        if (attempt % 6 === 0) {
            if (onProgress) {
                onProgress(Math.round((attempt / MAX_ATTEMPTS) * 100));
            }
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        const current = runSingleAttempt(mappings, allClasses, _allTeachers, allSubjects, normalizedConstraints, globalFailureCounts, initialSchedules, resourceTypeCache, _globalRules, fixedSlots);

        current.tasks.forEach(t => {
            if (!t.isPlaced) {
                const key = `${t.mapping.classId}-${t.mapping.teacherId}-${t.mapping.subjectId}-${t.blockLength}`;
                globalFailureCounts.set(key, (globalFailureCounts.get(key) || 0) + 1);
            }
        });

        // ÖNEMLİ: En iyi sonuç seçimi - çakışmasız sonuçları tercih et!
        // Öncelik: 1) Çakışmasız ve daha fazla yerleştirilmiş
        //          2) Çakışmasız (mevcut en iyiden daha az bile olsa)
        //          3) Daha az çakışmalı
        const currentBestConflicts = bestResult.conflictCount ?? Infinity;
        const shouldUpdate =
            // Mevcut çakışmasız ve yeni de çakışmasız ama daha iyi
            (current.conflictCount === 0 && currentBestConflicts === 0 && current.placedCount > bestResult.placedLessons) ||
            // Mevcut çakışmalı ama yeni çakışmasız
            (current.conflictCount === 0 && currentBestConflicts > 0) ||
            // İkisi de çakışmalı ama yeni daha az çakışmalı
            (current.conflictCount > 0 && current.conflictCount < currentBestConflicts) ||
            // İkisi de aynı çakışma sayısına sahip ama yeni daha fazla yerleştirmiş
            (current.conflictCount === currentBestConflicts && current.placedCount > bestResult.placedLessons);

        if (shouldUpdate) {
            // Collect ALL teacher IDs from: mappings, initial schedules, fixed slots, AND the grid
            const allTIds = new Set(mappings.map(m => m.teacherId));
            if (initialSchedules) {
                initialSchedules.forEach(s => allTIds.add(s.teacherId));
            }
            // ÖNEMLİ: Sabit derslerin öğretmenlerini de ekle!
            if (fixedSlots && fixedSlots.length > 0) {
                fixedSlots.forEach(slot => allTIds.add(slot.teacherId));
            }
            // ÖNEMLİ: Grid'deki TÜM öğretmenleri ekle (esnek yerleştirme dahil)
            Object.values(current.grid).forEach(classGrid => {
                Object.values(classGrid).forEach(dayGrid => {
                    Object.values(dayGrid as any).forEach((slot: any) => {
                        if (slot && slot.teacherId) {
                            allTIds.add(slot.teacherId);
                        }
                    });
                });
            });

            const tSchedules: { [id: string]: any } = {};
            allTIds.forEach(id => {
                tSchedules[id] = {};
                DAYS.forEach(d => tSchedules[id][d] = {});
            });

            // Populate from the current grid (which includes initial schedules as isFixed: true)
            let _gridSlotCount = 0;
            let _schedulesSlotCount = 0;
            Object.entries(current.grid).forEach(([cId, g]) => {
                Object.entries(g).forEach(([d, pObj]) => {
                    Object.entries(pObj as any).forEach(([p, slot]: [string, any]) => {
                        if (slot && slot.teacherId) {
                            _gridSlotCount++;
                            if (allTIds.has(slot.teacherId)) {
                                tSchedules[slot.teacherId][d][p] = {
                                    classId: cId,
                                    subjectId: slot.subjectId,
                                    // ÖNEMLİ: Sabit ders bilgilerini koru
                                    ...(slot.isFixed && { isFixed: true }),
                                    ...(slot.isFixedSlot && { isFixedSlot: true })
                                };
                                _schedulesSlotCount++;
                            } else {
                                // console.warn(`[KAYIP DERS] Öğretmen allTIds'de yok: ${slot.teacherId}, Sınıf: ${cId}, Gün: ${d}, Saat: ${p}`);
                            }
                        }
                    });
                });
            });
            // console.log(`[SCHEDULES] Grid: ${gridSlotCount} slot, Schedules'a aktarılan: ${schedulesSlotCount} slot`);

            // === DEBUG: Sınıf-Ders bazlı slot sayımı ===
            const classSubjectCounts: Map<string, Map<string, number>> = new Map();
            Object.entries(current.grid).forEach(([cId, g]) => {
                if (!classSubjectCounts.has(cId)) classSubjectCounts.set(cId, new Map());
                Object.entries(g).forEach(([_d, pObj]) => {
                    Object.entries(pObj as any).forEach(([_p, slot]: [string, any]) => {
                        if (slot && slot.subjectId) {
                            const count = classSubjectCounts.get(cId)!.get(slot.subjectId) || 0;
                            classSubjectCounts.get(cId)!.set(slot.subjectId, count + 1);
                        }
                    });
                });
            });
            // Tüm sınıflar ve dersler için sayıları logla (en az 5 saat olanları)
            // console.warn(`%c=== SINIF-DERS BAZLI SLOT SAYIMI ===`, 'color: blue; font-weight: bold;');
            classSubjectCounts.forEach((_subjects, _cId) => {
                _subjects.forEach((count, _subId) => {
                    if (count >= 4) { // Sadece 4+ saat dersleri göster
                        // console.warn(`📊 [${cId}] ${subId}: ${count} saat`);
                    }
                });
            });
            bestResult = {
                schedules: Object.entries(tSchedules).map(([tId, s]) => ({ teacherId: tId, schedule: s, updatedAt: new Date() })),
                placedLessons: current.placedCount,
                unassignedTasks: current.tasks.filter(t => !t.isPlaced),
                grid: current.grid,
                conflictCount: current.conflictCount
            };
        }
    }

    // --- POST-GENERATION AUDIT ---
    // console.log("%c=== SCHEDULER POST-GENERATION AUDIT ===", "color: green; font-weight: bold; font-size: 14px;");
    const errors: string[] = [];
    const constraintMap = new Map<string, string>();
    timeConstraints.forEach(c => {
        constraintMap.set(`${c.entityType}-${c.entityId}-${c.day}-${c.period}`, c.constraintType);
        if (c.entityType === 'subject') {
            const subject = allSubjects.find(s => s.id === c.entityId);
            if (subject) constraintMap.set(`subjectname-${slugify(subject.name)}-${c.day}-${c.period}`, c.constraintType);
        }
    });

    bestResult.schedules.forEach(s => {
        Object.entries(s.schedule).forEach(([day, periods]: [string, any]) => {
            Object.entries(periods).forEach(([period, slot]: [string, any]) => {
                const getConstraintLoose = (type: string, id: string, d: string, p: string) => {
                    const raw = constraintMap.get(`${type}-${id}-${d}-${p}`);
                    if (raw) return raw;
                    const norm = constraintMap.get(`${type}-${normalizeId(id, type as any)}-${d}-${p}`);
                    if (norm) return norm;

                    const idSC = superClean(id);
                    for (const [key, val] of constraintMap.entries()) {
                        if (key.includes(`${d}-${p}`) && key.startsWith(`${type}-`)) {
                            const parts = key.split('-');
                            if (parts.length >= 4) {
                                const idInKey = parts.slice(1, -2).join('');
                                if (superClean(idInKey) === idSC) return val;
                            }
                        }
                    }
                    return undefined;
                };

                const tConstraint = getConstraintLoose('teacher', s.teacherId, day, period);

                if (tConstraint === 'unavailable') {
                    errors.push(`VİOLASYON: ${s.teacherId} öğretmeni ${day} ${period}. saatte meşgul ama ders atandı!`);
                }
                if (slot.subjectId) {
                    const subject = allSubjects.find(sub => sub.id === slot.subjectId);
                    if (subject) {
                        const nameKey = slugify(subject.name);
                        if (constraintMap.get(`subjectname-${nameKey}-${day}-${period}`) === 'unavailable') {
                            errors.push(`VİOLASYON: ${subject.name} dersi ${day} ${period}. saatte yasak ama ${s.teacherId} tarafından ${slot.classId} sınıfına verildi!`);
                        }
                    }
                }
            });
        });
    });

    if (errors.length > 0) {
        // console.error("%c!!! CONSTRAINT VIOLATIONS DETECTED !!!", "color: red; font-weight: bold; font-size: 16px;");
        // errors.forEach(e => console.error(e));
    } else {
        // console.log("%cNo constraint violations detected in final result. ✅", "color: green;");
    }

    const unassignedLessons = bestResult.unassignedTasks
        .filter(t => !t.mapping.id.startsWith('auto-kulup-teacher-'))
        .map(t => ({
            className: allClasses.find(c => c.id === t.mapping.classId)?.name || 'Bilinmeyen',
            subjectName: allSubjects.find(s => s.id === t.mapping.subjectId)?.name || 'Bilinmeyen',
            teacherName: _allTeachers.find(th => th.id === t.mapping.teacherId)?.name || 'Bilinmeyen',
            missingHours: t.blockLength
        }));

    // === BEKLENEN VS GERÇEK SLOT KARŞILAŞTIRMASI ===
    const expectedSlots = new Map<string, { classId: string, subjectId: string, count: number }>();
    const actualSlots = new Map<string, number>();
    const SEP = '|||'; // Tire yerine benzersiz ayırıcı

    // Beklenen slotları hesapla (mappings'den)
    mappings.filter(m => !m.id.startsWith('auto-kulup-teacher-')).forEach(m => {
        const key = `${m.classId}${SEP}${m.subjectId}`;
        const existing = expectedSlots.get(key);
        if (existing) {
            existing.count += m.weeklyHours;
        } else {
            expectedSlots.set(key, { classId: m.classId, subjectId: m.subjectId, count: m.weeklyHours });
        }
    });

    // Gerçek slotları hesapla (finalGrid'den)
    if (bestResult.grid) {
        Object.entries(bestResult.grid).forEach(([classId, days]) => {
            Object.values(days).forEach((periods: any) => {
                Object.values(periods).forEach((slot: any) => {
                    if (slot && slot.subjectId) {
                        const key = `${classId}${SEP}${slot.subjectId}`;
                        actualSlots.set(key, (actualSlots.get(key) || 0) + 1);
                    }
                });
            });
        });
    }

    // Eksik slotları logla
    let mismatchCount = 0;
    let _totalMissingHours = 0;
    expectedSlots.forEach((expected, key) => {
        const actual = actualSlots.get(key) || 0;
        if (expected.count !== actual) {
            mismatchCount++;
            const missingHours = expected.count - actual;
            _totalMissingHours += missingHours;
            const _className = allClasses.find(c => c.id === expected.classId)?.name || expected.classId;
            const _subjectName = allSubjects.find(s => s.id === expected.subjectId)?.name || expected.subjectId;
            // console.warn(`🔴 [SLOT-EKSIK] ${className} → ${subjectName}: Beklenen ${expected.count}, Gerçek ${actual} (${missingHours} eksik)`);
        }
    });
    if (mismatchCount > 0) {
        // console.warn(`📊 [ÖZET] Toplam ${mismatchCount} ders-sınıf kombinasyonunda ${totalMissingHours} saat eksik!`);
    }

    // === ÖĞRETMEN BAZLI SLOT KARŞILAŞTIRMASI ===
    const expectedTeacherSlots = new Map<string, { teacherId: string, count: number }>();
    const actualTeacherSlots = new Map<string, number>();

    // Beklenen öğretmen slotlarını hesapla (mappings'den)
    mappings.filter(m => !m.id.startsWith('auto-kulup-teacher-')).forEach(m => {
        const teacherId = m.teacherId;
        const existing = expectedTeacherSlots.get(teacherId);
        if (existing) {
            existing.count += m.weeklyHours;
        } else {
            expectedTeacherSlots.set(teacherId, { teacherId, count: m.weeklyHours });
        }
    });

    // Gerçek öğretmen slotlarını hesapla (finalGrid'den)
    if (bestResult.grid) {
        Object.values(bestResult.grid).forEach((days: any) => {
            Object.values(days).forEach((periods: any) => {
                Object.values(periods).forEach((slot: any) => {
                    if (slot && slot.teacherId && !slot.teacherId.startsWith('KULÜP')) {
                        actualTeacherSlots.set(slot.teacherId, (actualTeacherSlots.get(slot.teacherId) || 0) + 1);
                    }
                });
            });
        });
    }

    // Öğretmen bazlı eksikleri logla
    let teacherMismatchCount = 0;
    let _totalTeacherMissingHours = 0;
    expectedTeacherSlots.forEach((expected, teacherId) => {
        const actual = actualTeacherSlots.get(teacherId) || 0;
        if (expected.count !== actual) {
            teacherMismatchCount++;
            const missingHours = expected.count - actual;
            _totalTeacherMissingHours += missingHours;
            const _teacherName = _allTeachers.find(t => t.id === teacherId)?.name || teacherId;
            // console.warn(`🔴 [ÖĞRETMEN-EKSIK] ${teacherName}: Beklenen ${expected.count}, Gerçek ${actual} (${missingHours} eksik)`);
        }
    });
    if (teacherMismatchCount > 0) {
        // console.warn(`📊 [ÖĞRETMEN-ÖZET] Toplam ${teacherMismatchCount} öğretmende ${totalTeacherMissingHours} saat eksik!`);
    }

    return {
        success: true,
        schedules: bestResult.schedules as Omit<Schedule, "id" | "createdAt">[],
        statistics: { totalLessonsToPlace, placedLessons: bestResult.placedLessons, unassignedLessons },
        warnings: bestResult.placedLessons < totalLessonsToPlace ? [`Eksik ders: ${totalLessonsToPlace - bestResult.placedLessons}`] : [],
        errors: errors.slice(0, 10),
        finalGrid: bestResult.grid || {}
    };
}