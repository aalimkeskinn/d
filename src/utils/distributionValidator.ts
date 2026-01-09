import { Subject, Schedule, Teacher, Class } from '../types/index';
import { ultraClean } from './idUtils';

/**
 * Dağıtım şekli karşılaştırma sonucu
 */
export interface DistributionMismatch {
  subjectId: string;
  subjectName: string;
  className: string;
  teacherName: string;
  level: 'Anaokulu' | 'İlkokul' | 'Ortaokul';
  expectedPattern: string;     // CSV'den (örn: "2+2+2+2")
  actualPattern: string;       // Program'dan hesaplanan (örn: "2+3+2+1")
  status: 'match' | 'mismatch' | 'no-expected' | 'no-schedule';
}

/**
 * Oluşturulan programlardan belirli bir ders-sınıf-öğretmen kombinasyonu için
 * gerçek dağıtım şeklini hesaplar.
 * 
 * @returns Günlük blok uzunluklarını içeren dizi (örn: [2, 2, 2])
 */
export const calculateActualDistribution = (
  schedules: Schedule[],
  subjectId: string,
  classId: string,
  teacherId: string
): number[] => {
  const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
  const dailyHours: number[] = [];

  // O öğretmenin programını bul
  const teacherSchedule = schedules.find(s => s.teacherId === teacherId);
  if (!teacherSchedule) return [];

  const cleanSubjectId = ultraClean(subjectId);
  const cleanClassId = ultraClean(classId);
  let totalMatched = 0;

  for (const day of DAYS) {
    const daySchedule = teacherSchedule.schedule[day];
    if (!daySchedule) {
      // Bu gün programda yok, 0 olarak sayılmaz
      continue;
    }

    let hoursThisDay = 0;
    for (const period of Object.keys(daySchedule)) {
      const slot = daySchedule[period];
      if (slot && slot.subjectId && slot.classId) {
        const slotSubjectClean = ultraClean(slot.subjectId);
        const slotClassClean = ultraClean(slot.classId);
        const sMatch = slotSubjectClean === cleanSubjectId;
        const cMatch = slotClassClean === cleanClassId;
        if (sMatch && cMatch) {
          hoursThisDay++;
          totalMatched++;
        }
      }
    }

    if (hoursThisDay > 0) {
      dailyHours.push(hoursThisDay);
    }
  }

  // Debug log: Her zaman göster
  // console.warn(`[DIST-DEBUG] ${teacherId} → ${subjectId} (${classId}): ${totalMatched} slot eşleşti, dağıtım: [${dailyHours.join('+')}]`);

  // Büyükten küçüğe sırala (dağıtım patternleri genellikle bu şekilde yazılır)
  return dailyHours.sort((a, b) => b - a);
};

/**
 * Dağıtım pattern'ini parse eder
 * Örn: "2+2+2" => [2, 2, 2]
 */
const parsePattern = (pattern: string | null | undefined): number[] => {
  if (!pattern || typeof pattern !== 'string') return [];
  return pattern
    .split('+')
    .map(n => parseInt(n.trim(), 10))
    .filter(n => !isNaN(n) && n > 0)
    .sort((a, b) => b - a); // Karşılaştırma için sırala
};

/**
 * İki dağıtımın eşit olup olmadığını kontrol eder
 */
const distributionsMatch = (expected: number[], actual: number[]): boolean => {
  if (expected.length !== actual.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) return false;
  }
  return true;
};

/**
 * Tüm derslerin dağıtım şekillerini doğrular
 */
export const validateDistributions = (
  subjects: Subject[],
  schedules: Schedule[],
  teachers: Teacher[],
  classes: Class[]
): DistributionMismatch[] => {
  const results: DistributionMismatch[] = [];
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const classMap = new Map(classes.map(c => [c.id, c]));

  for (const subject of subjects) {
    // Subject'in className'inden class ID'sini bul
    let classId = '';
    let className = subject.className || '';

    // className varsa, class ID'sini bul
    if (className) {
      const classItem = classes.find(c => c.name === className);
      if (classItem) {
        classId = classItem.id;
      }
    }

    // Subject ID'sinden class ve teacher bilgilerini çıkarmaya çalış
    // Format: sub-[classname]-[teachername]-[subjectname]
    const subjectIdParts = subject.id.split('-');
    if (subjectIdParts.length >= 3 && !classId) {
      const possibleClassName = subjectIdParts[1]?.toUpperCase();
      const classItem = classes.find(c =>
        c.name.toUpperCase() === possibleClassName ||
        c.id.toUpperCase().includes(possibleClassName)
      );
      if (classItem) {
        classId = classItem.id;
        className = classItem.name;
      }
    }

    if (!classId) continue; // Sınıf bulunamadı, atla

    // Bu ders için hangi öğretmenin atandığını bul
    const classItem = classMap.get(classId);
    if (!classItem || !classItem.assignments) continue;

    let teacherId = '';
    for (const assignment of classItem.assignments) {
      if (assignment.subjectIds.some(sid => ultraClean(sid) === ultraClean(subject.id))) {
        teacherId = assignment.teacherId;
        break;
      }
    }

    if (!teacherId) continue; // Öğretmen bulunamadı, atla

    const teacher = teacherMap.get(teacherId);
    const teacherName = teacher?.name || 'Bilinmeyen';

    // Beklenen dağıtım (CSV'den)
    const expectedPattern = subject.distributionPattern || '';
    const expectedDist = parsePattern(expectedPattern);

    // Gerçek dağıtım (programdan)
    const actualDist = calculateActualDistribution(schedules, subject.id, classId, teacherId);
    const actualPattern = actualDist.length > 0 ? actualDist.join('+') : '';

    // Durum belirleme
    let status: DistributionMismatch['status'];

    if (actualDist.length === 0) {
      status = 'no-schedule';
    } else if (expectedDist.length === 0) {
      status = 'no-expected';
    } else if (distributionsMatch(expectedDist, actualDist)) {
      status = 'match';
    } else {
      status = 'mismatch';
    }

    // Eğitim seviyesini belirle (subject veya class'tan)
    const level = subject.level || classItem?.level || 'İlkokul';

    results.push({
      subjectId: subject.id,
      subjectName: subject.name,
      className,
      teacherName,
      level,
      expectedPattern,
      actualPattern,
      status
    });
  }

  return results;
};

/**
 * Sonuçları özetler
 */
export const summarizeResults = (results: DistributionMismatch[]): {
  total: number;
  matches: number;
  mismatches: number;
  noExpected: number;
  noSchedule: number;
} => {
  return {
    total: results.length,
    matches: results.filter(r => r.status === 'match').length,
    mismatches: results.filter(r => r.status === 'mismatch').length,
    noExpected: results.filter(r => r.status === 'no-expected').length,
    noSchedule: results.filter(r => r.status === 'no-schedule').length
  };
};

// --- END OF FILE src/utils/distributionValidator.ts ---
